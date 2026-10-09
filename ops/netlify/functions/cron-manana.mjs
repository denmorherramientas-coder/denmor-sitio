// Todos los días a las 8:03 (Chihuahua): revisión del inventario.
import * as repo from '../../lib/repo.js';
import { programar } from '../../lib/tareas.js';
import { disparar } from '../../lib/servicios.js';

export default async () => {
  try {
    await programar('revision_inventario', { cadaHoras: 20 });
    await disparar('tareas-background', {});
  } catch (e) {
    await repo.registrarError('cron-manana', e).catch(() => {});
  }
};

// Hora en UTC (Chihuahua = UTC-6 todo el año). 14:03 UTC = 8:03 en Chihuahua.
export const config = { schedule: '3 14 * * *' };
