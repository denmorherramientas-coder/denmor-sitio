// ADMINISTRADOR: reporte diario de operación (datos reales de la base, sin IA).
import * as repo from '../repo.js';

const mx = (n) => '$' + Math.round(n || 0).toLocaleString('es-MX');

export async function reporteDiario(fecha = null) {
  const r = await repo.resumenDia(fecha);
  const interes = (await repo.interesados(1, 30)).map((i) => ({ nombre: i.nombre || 'Sin nombre', nota: i.nota_interes, seguimiento: i.acepta_seguimiento }));
  const cot = (await repo.listarCotizaciones(30)).filter((q) => Date.now() - new Date(q.creado) < 24 * 3600e3).map((q) => ({ folio: q.folio, total: q.total, cliente: q.nombre || 'Sin nombre' }));
  const errores = (await repo.listarErrores(20)).filter((e) => Date.now() - new Date(e.creado) < 24 * 3600e3).map((e) => `${e.origen}: ${e.mensaje}`);
  const reportes = await repo.listarReportes({ limite: 10 });
  const ultimo = (agente) => reportes.find((x) => x.agente === agente);
  const sup = ultimo('supervisor'), inv = ultimo('inventarios');
  const texto = [
    `Conversaciones atendidas: ${r.conversaciones} (${r.mensajes_recibidos} mensajes recibidos)`,
    `Respuestas del asistente: ${r.respuestas_asistente} · respuestas del equipo: ${r.respuestas_humanas}`,
    `Clientes interesados: ${r.interesados}`,
    `Cotizaciones: ${r.cotizaciones} por ${mx(r.monto_cotizado)}`,
    `Conversaciones esperando a una persona: ${r.conversaciones_humano}`,
    `Tareas completadas: ${r.tareas_completadas} · pendientes: ${r.tareas_pendientes} · aprobaciones por decidir: ${r.aprobaciones_pendientes}`,
    `Problemas registrados: ${r.errores}`,
    `Costo de IA del día: US$${r.costo_ia_usd.toFixed(2)}`,
    sup ? `Sitio web: ${sup.titulo}` : '',
    inv ? `Inventario: ${inv.texto.split('\n')[0]}` : '',
  ].filter(Boolean).join('\n');
  return { resumen: r, interesados: interes, cotizaciones: cot, errores, texto };
}
