// Ejecuta las tareas pendientes de los agentes (hasta 15 minutos por llamada).
import * as repo from '../../lib/repo.js';
import { ejecutarPendientes } from '../../lib/tareas.js';
import { claude, whatsapp, catalogo, esInterno } from '../../lib/servicios.js';

export default async (req) => {
  if (!esInterno(req)) return new Response('no autorizado', { status: 401 });
  try {
    await ejecutarPendientes({ cliente: claude(), wa: whatsapp(), catalogo });
  } catch (e) {
    await repo.registrarError('tareas', e);
  }
  return new Response('ok');
};

export const config = { background: true };
