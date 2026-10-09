// COORDINADOR: convierte las órdenes del propietario (lenguaje natural) en tareas para cada agente.
import * as repo from '../repo.js';
import { respuestaEstructurada } from '../ia/claude.js';

const AGENTES_TAREAS = ['vendedor', 'supervisor', 'inventarios', 'administrador', 'marketing', 'programador'];

export const ESQUEMA = {
  type: 'object',
  properties: {
    respuesta: { type: 'string', description: 'Confirmación breve para el propietario de lo que se hará' },
    tareas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          agente: { type: 'string', enum: AGENTES_TAREAS },
          titulo: { type: 'string' },
          descripcion: { type: 'string', description: 'Instrucciones completas para el agente' },
          prioridad: { type: 'string', enum: ['baja', 'normal', 'alta', 'urgente'] },
          requiere_aprobacion: { type: 'boolean', description: 'true si implica publicar, enviar mensajes a clientes, cambiar precios, descuentos o dinero' },
        },
        required: ['agente', 'titulo', 'descripcion', 'prioridad', 'requiere_aprobacion'],
        additionalProperties: false,
      },
    },
    no_se_puede: { type: 'array', items: { type: 'string' }, description: 'Partes de la orden que ningún agente puede hacer, con la razón' },
  },
  required: ['respuesta', 'tareas', 'no_se_puede'],
  additionalProperties: false,
};

const SISTEMA = `Eres el COORDINADOR de DENMOR AI OPERATIONS, el equipo de empleados digitales de Denmor Herramientas.
Recibes órdenes del propietario y las divides en tareas para estos agentes:
- vendedor: atiende WhatsApp automáticamente; en tareas puede revisar interesados y PROPONER mensajes de seguimiento.
- supervisor: revisa que el sitio denmorherramientas.com funcione (páginas, buscador, enlaces, botón de WhatsApp, existencias).
- inventarios: revisa el catálogo (fotos, precios, existencias, duplicados) y puede proponer cambios.
- administrador: reportes de conversaciones, cotizaciones, interesados, tareas y costos.
- marketing: propone publicaciones y campañas con productos reales (no publica).
- programador: analiza errores y propone correcciones (no cambia código).
Reglas:
- Ningún agente publica, envía mensajes a clientes, cambia precios, da descuentos ni mueve dinero sin aprobación: marca requiere_aprobacion = true en esas tareas.
- No inventes capacidades: si algo no lo puede hacer ningún agente (por ejemplo pagar, facturar o llamar por teléfono), ponlo en no_se_puede.
- Usa pocas tareas, bien descritas. Prioridad "urgente" solo si el propietario lo pide o hay un problema que afecta ventas.
- Responde en español de México.`;

export async function interpretarOrden(orden, { cliente, cfg }) {
  const conf = cfg.agentes.coordinador;
  const plan = await respuestaEstructurada({
    cliente, modelo: conf.modelo, esfuerzo: conf.esfuerzo, sistema: SISTEMA, texto: `Orden del propietario:\n${orden.texto}`, esquema: ESQUEMA,
    alUsar: (uso, modelo) => repo.registrarUso({ agente: 'coordinador', modelo, uso }),
  });
  const creadas = [];
  for (const t of (plan.tareas || []).slice(0, 10)) {
    if (!AGENTES_TAREAS.includes(t.agente)) continue;
    const trabajo = t.agente === 'supervisor' ? 'revision_sitio' : t.agente === 'inventarios' ? 'revision_inventario' : 'libre';
    const tarea = await repo.crearTarea({ agente: t.agente, titulo: t.titulo, descripcion: t.descripcion, prioridad: t.prioridad, origen: 'propietario', ordenId: orden.id, creadoPor: orden.creado_por, trabajo, estado: t.requiere_aprobacion ? 'esperando_aprobacion' : 'pendiente' });
    if (t.requiere_aprobacion) await repo.solicitarAprobacion({ tipo: 'cambio_importante', titulo: `Autorizar tarea: ${t.titulo}`, detalle: { agente: t.agente, descripcion: t.descripcion, nota: 'Al aprobar, el agente prepara la propuesta; lo que vaya a publicarse o enviarse vuelve a pedir aprobación.' }, solicitadoPor: 'coordinador', tareaId: tarea.id });
    creadas.push(tarea.id);
  }
  await repo.actualizarOrden(orden.id, 'interpretada', { ...plan, tareas_creadas: creadas });
  return { ...plan, tareas_creadas: creadas };
}
