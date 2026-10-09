// Atiende una conversación en segundo plano (hasta 15 minutos): espera, prepara la respuesta con Claude y la envía.
import * as repo from '../../lib/repo.js';
import { atender } from '../../lib/flujo/atender.js';
import { depsAtencion, esInterno } from '../../lib/servicios.js';

export default async (req) => {
  if (!esInterno(req)) return new Response('no autorizado', { status: 401 });
  const ev = await req.json().catch(() => ({}));
  if (!ev.conversacionId) return new Response('falta conversación', { status: 400 });
  try {
    const extra = ev.sinEspera ? { dormir: async () => {} } : {};
    await atender({ conversacionId: ev.conversacionId, recibido: ev.recibido ? new Date(ev.recibido) : null }, depsAtencion(extra));
  } catch (e) {
    await repo.registrarError('atender', e, { conversacion: ev.conversacionId });
  }
  return new Response('ok');
};

export const config = { background: true };
