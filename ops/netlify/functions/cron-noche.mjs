// Todos los días a las 19:55 (Chihuahua): reporte diario del administrador.
import * as repo from '../../lib/repo.js';
import { programar } from '../../lib/tareas.js';
import { disparar } from '../../lib/servicios.js';

export default async () => {
  try {
    await programar('reporte_diario', { cadaHoras: 20 });
    await disparar('tareas-background', {});
  } catch (e) {
    await repo.registrarError('cron-noche', e).catch(() => {});
  }
};

// Hora en UTC (Chihuahua = UTC-6 todo el año). 01:55 UTC = 19:55 en Chihuahua.
export const config = { schedule: '55 1 * * *' };
