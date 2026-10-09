// Cada hora: revisión del sitio, tareas atoradas y reactivación automática (si está configurada).
import * as repo from '../../lib/repo.js';
import { programar } from '../../lib/tareas.js';
import { disparar } from '../../lib/servicios.js';

export default async () => {
  try {
    const cfg = await repo.config({ fresca: true });
    await repo.recuperarTareasAtoradas();
    await repo.reactivarInactivas(cfg.humano.reactivar_tras_horas);
    if (cfg.agentes.supervisor.activo) await programar('revision_sitio', { cadaHoras: 1 });
    await disparar('tareas-background', {});
  } catch (e) {
    await repo.registrarError('cron-cada-hora', e).catch(() => {});
  }
};

// Hora en UTC (Chihuahua = UTC-6 todo el año). Minuto 7 de cada hora.
export const config = { schedule: '7 * * * *' };
