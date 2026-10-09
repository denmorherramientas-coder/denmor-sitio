// Agentes con IA que cumplen tareas en lenguaje natural (administrador, marketing, programador y seguimiento del vendedor).
// Solo tienen herramientas de CONSULTA. Cualquier cambio, publicación o mensaje a clientes se convierte en una
// solicitud de aprobación para el propietario.
import * as repo from '../repo.js';
import { buscar, fichaModelo } from '../catalogo/index.js';
import { ejecutarAgente } from '../ia/claude.js';

const PAPEL = {
  administrador: 'Eres el ADMINISTRADOR de operaciones. Preparas reportes claros de ventas, conversaciones, cotizaciones y operación con los datos de las herramientas.',
  marketing: 'Eres el agente de MARKETING. Propones publicaciones (Instagram @denmorherramientas, estados de WhatsApp, Facebook) y seguimiento comercial basado en productos reales con existencia. Tono: directo, de ferretería profesional, sin exagerar. Nunca publicas ni envías nada: lo propones para aprobación.',
  programador: 'Eres el agente PROGRAMADOR. Analizas errores y revisiones del sistema y del catálogo, explicas la causa probable en lenguaje sencillo y propones correcciones concretas (qué archivo o servicio revisar y qué cambiar). No cambias código ni configuración: propones.',
  vendedor: 'Eres el VENDEDOR en modo de seguimiento. Revisas clientes interesados y propones mensajes de seguimiento breves, amables y sin presión. Solo a quienes aceptaron seguimiento. Nunca envías: propones para aprobación.',
  supervisor: 'Eres el SUPERVISOR del sitio. Explicas el estado del sitio con base en las revisiones registradas.',
  inventarios: 'Eres el agente de INVENTARIOS. Explicas problemas del catálogo con base en las revisiones registradas y en el catálogo.',
};

const REGLAS = `REGLAS
- Usa solo datos de las herramientas. Si un dato no está, dilo; no lo inventes.
- No muestres teléfonos ni datos personales completos en tus respuestas.
- Todo lo que implique publicar, enviar mensajes a clientes, cambiar precios, dar descuentos o mover dinero se propone con la herramienta de propuesta correspondiente y queda pendiente de aprobación del propietario.
- Responde en español de México, claro y breve: primero la conclusión, luego el detalle en viñetas.`;

const s = (d) => ({ type: 'string', description: d });
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const HERR = {
  resumen_operacion: { description: 'Resumen por día de conversaciones, cotizaciones, interesados, errores y costo de IA.', input_schema: obj({ dias: { type: 'integer', description: '1 a 31' } }) },
  buscar_productos: { description: 'Busca productos del catálogo publicado con precio público y existencia.', input_schema: obj({ consulta: s('Palabras o modelo'), solo_con_existencia: { type: 'boolean' } }) },
  listar_interesados: { description: 'Clientes interesados recientes (sin teléfono).', input_schema: obj({ dias: { type: 'integer', description: '1 a 30' } }) },
  listar_cotizaciones: { description: 'Cotizaciones recientes.', input_schema: obj({ limite: { type: 'integer', description: '1 a 50' } }) },
  listar_errores: { description: 'Errores recientes del sistema.', input_schema: obj({ limite: { type: 'integer', description: '1 a 50' } }) },
  ver_reportes: { description: 'Últimos reportes de un agente (supervisor, inventarios, administrador, marketing, programador).', input_schema: obj({ agente: s('Nombre del agente'), limite: { type: 'integer', description: '1 a 5' } }) },
  proponer_publicacion: { description: 'Propone una publicación para aprobación del propietario (no publica).', input_schema: obj({ canal: { type: 'string', enum: ['instagram', 'facebook', 'estado_whatsapp'] }, titulo: s('Título corto'), texto: s('Texto completo de la publicación'), claves: { type: 'array', items: { type: 'string' }, description: 'Claves de productos mencionados' } }) },
  proponer_seguimiento: { description: 'Propone mensajes de seguimiento a clientes que aceptaron seguimiento (no envía).', input_schema: obj({ mensajes: { type: 'array', items: obj({ conversacion_id: s('Id de la conversación'), texto: s('Mensaje breve') }) } }) },
  proponer_cambio: { description: 'Propone un cambio (precio, configuración, corrección técnica u operación sensible) para aprobación.', input_schema: obj({ tipo: { type: 'string', enum: ['cambio_precio', 'cambio_importante', 'operacion_financiera', 'otro'] }, titulo: s('Título corto'), detalle: s('Qué cambiar, por qué y riesgos') }) },
};
const PERMISOS = {
  administrador: ['resumen_operacion', 'listar_interesados', 'listar_cotizaciones', 'listar_errores', 'ver_reportes', 'buscar_productos', 'proponer_cambio'],
  marketing: ['buscar_productos', 'resumen_operacion', 'listar_interesados', 'ver_reportes', 'proponer_publicacion', 'proponer_seguimiento'],
  programador: ['listar_errores', 'ver_reportes', 'resumen_operacion', 'proponer_cambio'],
  vendedor: ['listar_interesados', 'listar_cotizaciones', 'buscar_productos', 'proponer_seguimiento'],
  supervisor: ['ver_reportes', 'listar_errores'],
  inventarios: ['ver_reportes', 'buscar_productos', 'proponer_cambio'],
};

const acota = (n, a, b) => Math.max(a, Math.min(b, Math.floor(+n || a)));

export async function trabajar(tarea, { cliente, cfg, catalogo }) {
  const agente = tarea.agente;
  const conf = cfg.agentes[agente] || cfg.agentes.administrador;
  const herramientas = (PERMISOS[agente] || []).map((n) => ({ name: n, strict: true, ...HERR[n] }));
  const propuestas = [];

  const ejecutar = async (nombre, e) => {
    if (!PERMISOS[agente]?.includes(nombre)) throw new Error('Herramienta no permitida para este agente');
    switch (nombre) {
      case 'resumen_operacion': return repo.resumenPeriodo(acota(e.dias, 1, 31));
      case 'buscar_productos': { const cat = await catalogo(); return buscar(cat, e.consulta, { soloConExistencia: !!e.solo_con_existencia, limite: 8 }).map((m) => fichaModelo(cat, m, { maxVariantes: 3 })); }
      case 'listar_interesados': return (await repo.interesados(acota(e.dias, 1, 30))).map((i) => ({ conversacion_id: i.conversacion_id, nombre: i.nombre ? i.nombre.split(' ')[0] : 'Cliente', interes: i.nota_interes, acepta_seguimiento: i.acepta_seguimiento, ultimo_mensaje: i.ultimo_entrante }));
      case 'listar_cotizaciones': return (await repo.listarCotizaciones(acota(e.limite, 1, 50))).map((q) => ({ folio: q.folio, total: q.total, partidas: q.partidas.map((p) => `${p.cantidad}× ${p.clave}`), estado: q.estado, fecha: q.creado }));
      case 'listar_errores': return (await repo.listarErrores(acota(e.limite, 1, 50))).map((x) => ({ origen: x.origen, mensaje: x.mensaje, fecha: x.creado, resuelto: x.resuelto }));
      case 'ver_reportes': return (await repo.listarReportes({ agente: e.agente, limite: acota(e.limite, 1, 5) })).map((r) => ({ titulo: r.titulo, texto: r.texto, fecha: r.creado }));
      case 'proponer_publicacion': {
        const a = await repo.solicitarAprobacion({ tipo: 'publicacion', titulo: `${e.canal}: ${e.titulo}`, detalle: e, solicitadoPor: agente, tareaId: tarea.id });
        propuestas.push(a.id); return { ok: true, aprobacion: a.id, nota: 'Queda pendiente de aprobación; no se publica nada.' };
      }
      case 'proponer_seguimiento': {
        const validos = [];
        const permitidos = new Set((await repo.interesados(30, 200)).filter((i) => i.acepta_seguimiento).map((i) => i.conversacion_id));
        for (const m of (e.mensajes || []).slice(0, 50)) if (permitidos.has(m.conversacion_id) && m.texto) validos.push({ conversacion_id: m.conversacion_id, texto: String(m.texto).slice(0, 700) });
        if (!validos.length) return { ok: false, nota: 'Ningún mensaje válido: solo se puede dar seguimiento a clientes que aceptaron.' };
        const a = await repo.solicitarAprobacion({ tipo: 'mensaje_masivo', titulo: `Seguimiento a ${validos.length} cliente(s)`, detalle: { mensajes: validos }, solicitadoPor: agente, tareaId: tarea.id });
        propuestas.push(a.id); return { ok: true, aprobacion: a.id, incluidos: validos.length };
      }
      case 'proponer_cambio': {
        const a = await repo.solicitarAprobacion({ tipo: e.tipo, titulo: e.titulo, detalle: { detalle: e.detalle }, solicitadoPor: agente, tareaId: tarea.id });
        propuestas.push(a.id); return { ok: true, aprobacion: a.id };
      }
    }
    throw new Error('Herramienta desconocida');
  };

  const sistema = `${PAPEL[agente] || PAPEL.administrador}\nTrabajas para ${cfg.negocio.nombre} (${cfg.negocio.ciudad}), venta de herramienta eléctrica nueva y seminueva (Milwaukee, DeWalt, Ryobi).\n\n${REGLAS}`;
  const r = await ejecutarAgente({
    cliente, modelo: conf.modelo || 'claude-opus-5-5', esfuerzo: conf.esfuerzo || 'medium', sistema, herramientas, ejecutar, maxTurnos: 10, maxTokens: 16000,
    mensajes: [{ role: 'user', content: `Tarea: ${tarea.titulo}\n${tarea.descripcion || ''}`.trim() }],
    alUsar: (uso, modelo) => repo.registrarUso({ agente, modelo, uso, tareaId: tarea.id }),
  });
  if (r.motivo !== 'fin') throw new Error(`El agente no terminó la tarea (${r.motivo}).`);
  return { texto: r.texto, propuestas };
}
