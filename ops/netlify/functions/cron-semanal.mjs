// Lunes 9:00 (Chihuahua): propuestas de marketing y seguimiento (quedan pendientes de aprobación).
import * as repo from '../../lib/repo.js';
import { programar } from '../../lib/tareas.js';
import { disparar } from '../../lib/servicios.js';

export default async () => {
  try {
    await programar('propuestas_marketing', { cadaHoras: 24 * 6 });
    await disparar('tareas-background', {});
  } catch (e) {
    await repo.registrarError('cron-semanal', e).catch(() => {});
  }
};

// Hora en UTC (Chihuahua = UTC-6 todo el año). Lunes 15:00 UTC = 9:00 en Chihuahua.
export const config = { schedule: '0 15 * * 1' };
