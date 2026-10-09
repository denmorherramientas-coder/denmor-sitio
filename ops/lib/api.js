// API del panel DENMOR AI OPERATIONS. Todas las rutas (salvo /api/publico) exigen sesión y estar en ops.operadores.
import * as repo from './repo.js';
import { operadorDeSolicitud } from './auth.js';
import { decidir } from './aprobaciones.js';
import { AGENTES, MODELOS, DEFAULTS, estadoVariables } from './config.js';
import { disparar, json, whatsapp, catalogo, urlSitio } from './servicios.js';
import { modoEnvio } from './whatsapp/d360.js';
import { enmascararTelefono, recortar } from './seguridad.js';
import { createHash } from 'node:crypto';

const SECCIONES_PROPIETARIO = new Set(['agentes', 'limites', 'catalogo', 'humano']);

async function cuerpo(req) {
  try { return await req.json(); } catch { return {}; }
}

const conv = (c) => ({ ...c, telefono: c.wa_id?.startsWith('sim-') ? 'Simulador' : enmascararTelefono(c.wa_id), wa_id: undefined, simulador: c.wa_id?.startsWith('sim-') });

export async function manejar(req) {
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const metodo = req.method;

  // configuración pública para iniciar sesión (la llave "anon" de Supabase es pública por diseño)
  if (ruta === '/publico' && metodo === 'GET') return json({ supabaseUrl: process.env.SUPABASE_URL || '', supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '' });

  const op = await operadorDeSolicitud(req);
  if (!op) return json({ error: 'Sin sesión o sin permiso para este panel.' }, 401);
  const quien = op.email;
  const esDueno = op.rol === 'propietario';
  const p = ruta.split('/').filter(Boolean); // ['conversaciones', id, 'tomar']

  try {
    /* ---------- sesión y tablero ---------- */
    if (ruta === '/sesion' && metodo === 'GET') return json({ email: op.email, nombre: op.nombre, rol: op.rol });

    if (ruta === '/tablero' && metodo === 'GET') {
      const [hoy, cfg, gasto, errores, reportes, tareas, aprob] = await Promise.all([
        repo.resumenDia(), repo.config({ fresca: true }), repo.gastoHoy(), repo.listarErrores(8), repo.listarReportes({ limite: 12 }), repo.listarTareas({ limite: 8 }), repo.listarAprobaciones({ estado: 'pendiente', limite: 5 }),
      ]);
      const ultimo = {};
      for (const r of reportes) if (!ultimo[r.agente]) ultimo[r.agente] = { titulo: r.titulo, creado: r.creado };
      return json({
        hoy, gasto_usd: gasto, presupuesto_usd: cfg.limites.presupuesto_diario_usd, pausa_global: cfg.agentes.pausa_global,
        agentes: AGENTES.map((a) => ({ agente: a, activo: cfg.agentes[a]?.activo !== false && !cfg.agentes.pausa_global, ultimo: ultimo[a] || null })),
        errores, tareas, aprobaciones: aprob,
      });
    }

    /* ---------- WhatsApp ---------- */
    if (p[0] === 'conversaciones') {
      if (p.length === 1 && metodo === 'GET') {
        const modo = ['asistente', 'humano'].includes(url.searchParams.get('modo')) ? url.searchParams.get('modo') : null;
        return json({ conversaciones: (await repo.listarConversaciones({ modo, buscar: recortar(url.searchParams.get('q') || '', 40), limite: 80 })).map(conv) });
      }
      const id = p[1];
      if (!/^[0-9a-f-]{36}$/.test(id || '')) return json({ error: 'id' }, 400);
      if (p.length === 2 && metodo === 'GET') {
        const c = await repo.conversacion(id);
        if (!c) return json({ error: 'No existe' }, 404);
        return json({ conversacion: conv(c), mensajes: await repo.historial(id, 150) });
      }
      if (p[2] === 'tomar' && metodo === 'POST') { await repo.cambiarModo(id, 'humano', `Tomada por ${quien}`, quien); return json({ ok: true }); }
      if (p[2] === 'reactivar' && metodo === 'POST') {
        await repo.cambiarModo(id, 'asistente', `Reactivada por ${quien}`, quien);
        // los mensajes que quedaron sin respuesta mientras atendía una persona no se contestan de golpe
        const pend = await repo.sinResponder(id);
        if (pend.length) await repo.marcarRespondido(id, pend[pend.length - 1].creado);
        return json({ ok: true });
      }
      if (p[2] === 'mensaje' && metodo === 'POST') {
        const b = await cuerpo(req);
        const texto = recortar(String(b.texto || '').trim(), 4000);
        if (!texto) return json({ error: 'Escribe un mensaje' }, 400);
        const c = await repo.conversacion(id);
        if (!c) return json({ error: 'No existe' }, 404);
        await repo.cambiarModo(id, 'humano', `Respondiendo ${quien} desde el panel`, quien);
        let r;
        try { r = await whatsapp().enviarTexto(c.wa_id, texto); } catch (e) {
          await repo.registrarSaliente({ conversacionId: id, autor: 'humano_panel', texto, estado: 'fallido', error: e.message, meta: { por: quien } });
          return json({ error: 'WhatsApp no aceptó el mensaje: ' + e.message }, 502);
        }
        await repo.registrarSaliente({ conversacionId: id, autor: 'humano_panel', texto, waMessageId: r.id, estado: r.simulado ? 'simulado' : 'enviado', meta: { por: quien } });
        return json({ ok: true, simulado: r.simulado });
      }
    }

    /* ---------- simulador (conversaciones de prueba que nunca salen a WhatsApp) ---------- */
    if (ruta === '/simulador' && metodo === 'POST') {
      const b = await cuerpo(req);
      const texto = recortar(String(b.texto || '').trim(), 2000);
      if (!texto) return json({ error: 'Escribe un mensaje' }, 400);
      const waId = 'sim-' + createHash('sha256').update(quien + '|' + (b.sesion || '1')).digest('hex').slice(0, 12);
      const r = await repo.registrarEntrante({ waId, nombre: b.nombre ? recortar(b.nombre, 60) : 'Cliente de prueba', waMessageId: 'sim.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8), texto });
      await disparar('atender-background', { conversacionId: r.conversacionId, recibido: r.creado, sinEspera: !!b.sinEspera });
      return json({ conversacionId: r.conversacionId });
    }

    /* ---------- agentes ---------- */
    if (ruta === '/agentes/pausa' && metodo === 'POST') {
      const b = await cuerpo(req);
      await repo.guardarConfig('agentes', { pausa_global: !!b.pausa }, quien);
      return json({ ok: true, pausa_global: !!b.pausa });
    }
    if (p[0] === 'agentes' && p.length === 2 && metodo === 'POST') {
      if (!esDueno) return json({ error: 'Solo el propietario puede cambiar los agentes.' }, 403);
      const a = p[1];
      if (!AGENTES.includes(a)) return json({ error: 'Agente desconocido' }, 400);
      const b = await cuerpo(req);
      const cambio = {};
      if (typeof b.activo === 'boolean') cambio.activo = b.activo;
      if (b.modelo && MODELOS[b.modelo] && DEFAULTS.agentes[a].modelo) cambio.modelo = b.modelo;
      if (['low', 'medium', 'high'].includes(b.esfuerzo) && DEFAULTS.agentes[a].esfuerzo) cambio.esfuerzo = b.esfuerzo;
      await repo.guardarConfig('agentes', { [a]: cambio }, quien);
      return json({ ok: true });
    }

    /* ---------- órdenes y tareas ---------- */
    if (ruta === '/ordenes' && metodo === 'GET') return json({ ordenes: await repo.listarOrdenes(30) });
    if (ruta === '/ordenes' && metodo === 'POST') {
      const b = await cuerpo(req);
      const texto = String(b.texto || '').trim();
      if (texto.length < 3) return json({ error: 'Escribe la orden' }, 400);
      const o = await repo.crearOrden(texto, quien);
      await repo.crearTarea({ agente: 'coordinador', trabajo: 'interpretar_orden', entrada: { orden_id: o.id }, titulo: `Interpretar orden: ${recortar(texto, 80)}`, prioridad: ['alta', 'urgente'].includes(b.prioridad) ? b.prioridad : 'normal', ordenId: o.id, creadoPor: quien });
      await disparar('tareas-background', {});
      return json({ orden: o });
    }
    if (ruta === '/tareas' && metodo === 'GET') return json({ tareas: await repo.listarTareas({ estado: url.searchParams.get('estado') || null, limite: 150 }) });
    if (ruta === '/tareas' && metodo === 'POST') {
      const b = await cuerpo(req);
      if (!AGENTES.includes(b.agente) || b.agente === 'coordinador' || !b.titulo) return json({ error: 'Agente y título son obligatorios' }, 400);
      const trabajo = b.agente === 'supervisor' ? 'revision_sitio' : b.agente === 'inventarios' ? 'revision_inventario' : 'libre';
      const t = await repo.crearTarea({ agente: b.agente, trabajo, titulo: b.titulo, descripcion: b.descripcion || '', prioridad: ['baja', 'normal', 'alta', 'urgente'].includes(b.prioridad) ? b.prioridad : 'normal', creadoPor: quien });
      await disparar('tareas-background', {});
      return json({ tarea: t });
    }
    if (p[0] === 'tareas' && p[2] === 'cancelar' && metodo === 'POST') return json({ ok: !!(await repo.cambiarEstadoTarea(p[1], 'cancelada', quien)) });
    if (p[0] === 'tareas' && p[2] === 'reintentar' && metodo === 'POST') {
      const t = await repo.tarea(p[1]);
      if (!t || !['fallida', 'cancelada'].includes(t.estado)) return json({ error: 'Solo se reintentan tareas fallidas o canceladas' }, 400);
      const n = await repo.crearTarea({ agente: t.agente, trabajo: t.trabajo, entrada: t.entrada, titulo: t.titulo, descripcion: t.descripcion, prioridad: t.prioridad, ordenId: t.orden_id, creadoPor: quien });
      await disparar('tareas-background', {});
      return json({ tarea: n });
    }

    /* ---------- aprobaciones ---------- */
    if (ruta === '/aprobaciones' && metodo === 'GET') return json({ aprobaciones: await repo.listarAprobaciones({ estado: url.searchParams.get('estado') || null, limite: 150 }) });
    if (p[0] === 'aprobaciones' && p.length === 2 && metodo === 'POST') {
      if (!esDueno) return json({ error: 'Solo el propietario aprueba.' }, 403);
      const b = await cuerpo(req);
      if (!['aprobada', 'rechazada'].includes(b.decision)) return json({ error: 'Decisión inválida' }, 400);
      const r = await decidir(p[1], b.decision, quien, recortar(b.nota || '', 1000));
      if (r.hayTareas) await disparar('tareas-background', {});
      return json(r, r.ok ? 200 : 409);
    }

    /* ---------- reportes, cotizaciones, errores, bitácora ---------- */
    if (ruta === '/reportes' && metodo === 'GET') return json({ reportes: await repo.listarReportes({ agente: url.searchParams.get('agente') || null, limite: 40 }) });
    if (ruta === '/cotizaciones' && metodo === 'GET') return json({ cotizaciones: (await repo.listarCotizaciones(100)).map((q) => ({ ...q, telefono: q.wa_id?.startsWith('sim-') ? 'Simulador' : enmascararTelefono(q.wa_id), wa_id: undefined })) });
    if (ruta === '/errores' && metodo === 'GET') return json({ errores: await repo.listarErrores(100) });
    if (ruta === '/bitacora' && metodo === 'GET') return json({ bitacora: await repo.listarBitacora(200) });

    /* ---------- configuración ---------- */
    if (ruta === '/config' && metodo === 'GET') return json({ config: await repo.config({ fresca: true }), modelos: MODELOS, rol: op.rol });
    if (p[0] === 'config' && p.length === 2 && metodo === 'PUT') {
      const sec = p[1];
      if (!(sec in DEFAULTS)) return json({ error: 'Sección desconocida' }, 400);
      if (SECCIONES_PROPIETARIO.has(sec) && !esDueno) return json({ error: 'Solo el propietario cambia esta sección.' }, 403);
      const b = await cuerpo(req);
      const err = validarSeccion(sec, b.valor);
      if (err) return json({ error: err }, 400);
      await repo.guardarConfig(sec, b.valor, quien);
      return json({ ok: true });
    }

    /* ---------- estado de conexiones ---------- */
    if (ruta === '/estado' && metodo === 'GET') {
      const est = { variables: estadoVariables(), whatsapp: modoEnvio(), sitio_ops: urlSitio(), webhook: `${urlSitio()}/webhook/whatsapp` };
      est.whatsapp = { envio_habilitado: est.whatsapp.habilitado, numeros_prueba: est.whatsapp.soloNumeros.map(enmascararTelefono) };
      try { const c = await catalogo(); est.catalogo = { ok: true, modelos: c.M.size, precios_confiables: c.preciosConfiables, existencias: c.existencias, avisos: c.avisos }; } catch (e) { est.catalogo = { ok: false, error: e.message }; }
      try { await repo.gastoHoy(); est.base_datos = { ok: true }; } catch (e) { est.base_datos = { ok: false, error: 'sin conexión' }; }
      return json(est);
    }
    if (ruta === '/whatsapp/conectar-webhook' && metodo === 'POST') {
      if (!esDueno) return json({ error: 'Solo el propietario.' }, 403);
      const b = await cuerpo(req);
      if (b.confirmo !== 'CONECTAR') return json({ error: 'Falta la confirmación' }, 400);
      if (!process.env.D360_API_KEY || (process.env.WEBHOOK_SECRETO || '').length < 32) return json({ error: 'Faltan D360_API_KEY o WEBHOOK_SECRETO en Netlify.' }, 400);
      const destino = `${urlSitio()}/webhook/whatsapp`;
      await whatsapp().configurarWebhook(destino, process.env.WEBHOOK_SECRETO);
      await repo.registrar(quien, 'whatsapp.webhook_conectado', null, null, { destino });
      return json({ ok: true, destino });
    }

    return json({ error: 'No encontrado' }, 404);
  } catch (e) {
    await repo.registrarError('api', e, { ruta, metodo }).catch(() => {});
    return json({ error: 'Error interno. Quedó registrado en Errores.' }, 500);
  }
}

// Validación básica de lo que se guarda desde el panel
function validarSeccion(sec, v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Valor inválido';
  if (sec === 'tiempos') {
    for (const k of ['saludo', 'consulta', 'cotizacion']) if (k in v) { const r = v[k]; if (!Array.isArray(r) || r.length !== 2 || !(r[0] >= 0 && r[1] >= r[0] && r[1] <= 120)) return `Tiempo de ${k}: usa dos números de 0 a 120 (mínimo ≤ máximo)`; }
    if ('agrupar' in v && !(v.agrupar >= 0 && v.agrupar <= 30)) return 'Agrupar: de 0 a 30 segundos';
  }
  if (sec === 'limites') {
    if ('presupuesto_diario_usd' in v && !(v.presupuesto_diario_usd >= 0 && v.presupuesto_diario_usd <= 500)) return 'Presupuesto: de 0 a 500 USD';
    if ('respuestas_por_contacto_dia' in v && !(v.respuestas_por_contacto_dia >= 1 && v.respuestas_por_contacto_dia <= 500)) return 'Respuestas por contacto: de 1 a 500';
  }
  if (sec === 'horario' && v.dias) {
    for (const [d, r] of Object.entries(v.dias)) if (r !== null && !(Array.isArray(r) && r.length === 2 && r.every((x) => /^([01]\d|2[0-4]):[0-5]\d$/.test(x)))) return `Horario del ${d}: usa HH:MM o déjalo cerrado`;
    if (v.fuera_de_horario && !['atender', 'mensaje', 'silencio'].includes(v.fuera_de_horario)) return 'Fuera de horario: atender, mensaje o silencio';
  }
  if (sec === 'catalogo') for (const k of ['core', 'existencias', 'ajustes', 'sitio']) if (k in v && !/^https:\/\/[^\s]+$/.test(v[k])) return `${k}: debe ser una dirección https`;
  return null;
}
