// Qué pasa cuando el propietario aprueba o rechaza algo.
import * as repo from './repo.js';

export async function decidir(id, decision, por, nota = '') {
  const a = await repo.decidirAprobacion(id, decision, por, nota);
  if (!a) return { ok: false, error: 'La aprobación ya fue decidida o no existe.' };
  const efectos = [];
  const aprobada = decision === 'aprobada';

  // tarea que esperaba esta aprobación
  if (a.tarea_id) {
    const t = await repo.tarea(a.tarea_id);
    if (t && t.estado === 'esperando_aprobacion') {
      await repo.cambiarEstadoTarea(t.id, aprobada ? 'pendiente' : 'cancelada', por);
      efectos.push(aprobada ? 'La tarea quedó en la fila de trabajo.' : 'La tarea se canceló.');
    }
  }
  // mensajes de seguimiento aprobados → tarea de envío
  if (aprobada && a.tipo === 'mensaje_masivo') {
    await repo.crearTarea({ agente: 'vendedor', trabajo: 'enviar_seguimiento', entrada: { aprobacion_id: a.id }, titulo: `Enviar: ${a.titulo}`, prioridad: 'alta', origen: 'agente', creadoPor: por });
    efectos.push('Se programó el envío (solo a clientes con conversación de menos de 24 h).');
  }
  // descuento: el asistente no negocia; la conversación pasa a una persona con la decisión
  if (a.tipo === 'descuento' && a.conversacion_id) {
    await repo.cambiarModo(a.conversacion_id, 'humano', `Descuento ${aprobada ? 'APROBADO' : 'rechazado'}${nota ? ': ' + nota : ''} — responde tú al cliente`, por);
    efectos.push('La conversación quedó para que tú le respondas al cliente con la decisión.');
  }
  if (aprobada && a.tipo === 'publicacion') efectos.push('Publicación aprobada: cópiala desde aquí y publícala en tu cuenta (el sistema no publica solo).');
  return { ok: true, aprobacion: a, efectos, hayTareas: efectos.some((e) => /tarea|envío/.test(e)) };
}
