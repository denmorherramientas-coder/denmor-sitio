// Ejecución de tareas de los agentes (desde órdenes del propietario o programadas).
import * as repo from './repo.js';
import { revisarSitio } from './agentes/supervisor.js';
import { revisarInventario } from './agentes/inventarios.js';
import { reporteDiario } from './agentes/administrador.js';
import { trabajar } from './agentes/trabajador.js';
import { interpretarOrden } from './agentes/coordinador.js';

export const TRABAJOS = {
  revision_sitio: { agente: 'supervisor', titulo: 'Revisión automática del sitio' },
  revision_inventario: { agente: 'inventarios', titulo: 'Revisión diaria del inventario' },
  reporte_diario: { agente: 'administrador', titulo: 'Reporte diario de operación' },
  propuestas_marketing: { agente: 'marketing', titulo: 'Propuestas semanales de publicaciones y seguimiento', descripcion: 'Revisa productos con existencia (sobre todo ofertas y piezas con varias unidades) y los clientes interesados de la semana. Propón 3 publicaciones (Instagram, Facebook o estado de WhatsApp) con productos reales, y mensajes de seguimiento solo para clientes que aceptaron seguimiento.' },
};

// Crea la tarea programada si no se creó una igual hace poco
export async function programar(trabajo, { cadaHoras = 1 } = {}) {
  const t = TRABAJOS[trabajo];
  if (await repo.tareaReciente(trabajo, cadaHoras * 0.9)) return null;
  return repo.crearTarea({ agente: t.agente, titulo: t.titulo, descripcion: t.descripcion || '', origen: 'programada', trabajo, creadoPor: 'programador_tareas' });
}

export async function ejecutarTarea(t, deps) {
  const cfg = await repo.config({ fresca: true });
  switch (t.trabajo) {
    case 'interpretar_orden': {
      const orden = await repo.orden(t.entrada.orden_id);
      if (!orden) throw new Error('No se encontró la orden');
      const plan = await interpretarOrden(orden, { cliente: deps.cliente, cfg });
      return { texto: [plan.respuesta, plan.no_se_puede?.length ? `No se puede: ${plan.no_se_puede.join('; ')}` : ''].filter(Boolean).join('\n'), datos: plan };
    }
    case 'revision_sitio': {
      const r = await revisarSitio(cfg, { fetchImpl: deps.fetchImpl });
      await repo.guardarReporte({ agente: 'supervisor', tipo: 'revision_sitio', titulo: r.resumen, texto: r.checks.map((c) => `${c.ok ? '✅' : '❌'} ${c.nombre}: ${c.detalle}`).join('\n'), datos: r });
      if (!r.ok) await repo.registrarError('supervisor', new Error(r.resumen), { fallas: r.checks.filter((c) => !c.ok) });
      return { texto: r.resumen, datos: r };
    }
    case 'revision_inventario': {
      const cat = await deps.catalogo();
      const r = revisarInventario(cat, cat.existenciasCrudas);
      await repo.guardarReporte({ agente: 'inventarios', tipo: 'revision_inventario', titulo: `Inventario: ${Object.values(r.conteo).reduce((a, b) => a + b, 0)} hallazgos`, texto: r.resumen, datos: r });
      return { texto: r.resumen, datos: r };
    }
    case 'reporte_diario': {
      const r = await reporteDiario();
      await repo.guardarReporte({ agente: 'administrador', tipo: 'reporte_diario', titulo: `Reporte del día · ${r.resumen.conversaciones} conversaciones · ${r.resumen.cotizaciones} cotizaciones`, texto: r.texto, datos: r });
      return { texto: r.texto, datos: r };
    }
    case 'enviar_seguimiento':
      return enviarSeguimiento(t, deps);
    case 'propuestas_marketing':
    case 'libre':
    default: {
      const r = await trabajar(t, { cliente: deps.cliente, cfg, catalogo: deps.catalogo });
      await repo.guardarReporte({ agente: t.agente, tipo: 'tarea', titulo: t.titulo, texto: r.texto, datos: { tarea: t.id, propuestas: r.propuestas } });
      return { texto: r.texto, datos: { propuestas: r.propuestas } };
    }
  }
}

// Envía los mensajes de seguimiento que el propietario aprobó (solo dentro de la ventana de 24 h de WhatsApp)
async function enviarSeguimiento(t, deps) {
  const a = await repo.aprobacion(t.entrada.aprobacion_id);
  if (!a || a.estado !== 'aprobada') throw new Error('La aprobación no existe o no está aprobada');
  const res = { enviados: 0, omitidos: [] };
  for (const m of a.detalle.mensajes || []) {
    const c = await repo.conversacion(m.conversacion_id);
    if (!c) { res.omitidos.push('conversación no encontrada'); continue; }
    if (c.modo === 'humano') { res.omitidos.push(`${c.nombre || 'cliente'}: lo atiende una persona`); continue; }
    if (!c.ultimo_entrante || Date.now() - new Date(c.ultimo_entrante) > 23.5 * 3600e3) { res.omitidos.push(`${c.nombre || 'cliente'}: pasaron más de 24 h desde su último mensaje (WhatsApp exige plantilla aprobada)`); continue; }
    const r = await deps.wa.enviarTexto(c.wa_id, m.texto);
    await repo.registrarSaliente({ conversacionId: c.id, autor: 'asistente', texto: m.texto, waMessageId: r.id, estado: r.simulado ? 'simulado' : 'enviado', meta: { seguimiento: a.id } });
    res.enviados++;
  }
  return { texto: `Seguimiento: ${res.enviados} enviado(s)${res.omitidos.length ? `; ${res.omitidos.length} omitido(s): ${res.omitidos.join('; ')}` : ''}.`, datos: res };
}

// Ejecuta tareas pendientes hasta agotar la cola o el tiempo disponible
export async function ejecutarPendientes(deps, { limiteMs = 12 * 60e3 } = {}) {
  const inicio = Date.now();
  let hechas = 0;
  while (Date.now() - inicio < limiteMs) {
    const cfg = await repo.config({ fresca: true });
    if (cfg.agentes.pausa_global) break;
    const activos = ['coordinador', 'vendedor', 'supervisor', 'inventarios', 'administrador', 'marketing', 'programador'].filter((a) => cfg.agentes[a]?.activo !== false);
    const t = await repo.tomarTarea(activos);
    if (!t) break;
    try {
      const r = await ejecutarTarea(t, deps);
      await repo.terminarTarea(t.id, { estado: 'completada', resultado: r.texto, datos: r.datos, actor: t.agente });
    } catch (e) {
      await repo.registrarError(`tarea:${t.agente}`, e, { tarea: t.id });
      await repo.terminarTarea(t.id, { estado: 'fallida', resultado: `No se pudo completar: ${e.message}`, actor: t.agente });
    }
    hechas++;
  }
  return hechas;
}
