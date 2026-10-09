// Recibe los avisos de 360dialog (mensajes de clientes, ecos de la app WhatsApp Business y estados de entrega).
// Responde rápido y deja el trabajo pesado a la función en segundo plano "atender-background".
import * as repo from '../../lib/repo.js';
import { leerWebhook } from '../../lib/whatsapp/d360.js';
import { mismoSecreto } from '../../lib/seguridad.js';
import { disparar, json } from '../../lib/servicios.js';

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: true, servicio: 'webhook de WhatsApp de Denmor' });
  const secreto = process.env.WEBHOOK_SECRETO || '';
  if (secreto.length < 32) return json({ error: 'webhook sin configurar' }, 503);
  if (!mismoSecreto(req.headers.get('x-denmor-secreto') || '', secreto)) return json({ error: 'no autorizado' }, 401);
  if (+(req.headers.get('content-length') || 0) > 1_000_000) return json({ error: 'demasiado grande' }, 413);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'formato' }, 400); }

  try {
    const cfg = await repo.config();
    const maxEdad = (cfg.limites.max_antiguedad_horas || 6) * 3600e3;
    for (const ev of leerWebhook(body)) {
      if (ev.tipo === 'mensaje') {
        const r = await repo.registrarEntrante({ waId: ev.waId, nombre: ev.nombre, waMessageId: ev.id, tipo: ev.tipoMensaje, texto: ev.texto, fecha: ev.fecha });
        if (r.duplicado) continue;
        if (Date.now() - ev.fecha.getTime() > maxEdad) {
          await repo.registrar('whatsapp', 'mensaje.antiguo', 'conversacion', r.conversacionId, { recibido: ev.fecha.toISOString() });
          continue;
        }
        await disparar('atender-background', { conversacionId: r.conversacionId, recibido: r.creado });
      } else if (ev.tipo === 'eco') {
        await repo.registrarEcoHumano({ waIdCliente: ev.waIdCliente, waMessageId: ev.id, tipo: ev.tipoMensaje, texto: ev.texto, fecha: ev.fecha, detener: cfg.humano.detener_si_respondes_en_app });
      } else if (ev.tipo === 'estado') {
        await repo.actualizarEntrega(ev.id, ev.estado, ev.error);
        if (ev.estado === 'failed') await repo.registrarError('whatsapp', new Error(`Mensaje no entregado: ${ev.error || 'sin detalle'}`), { mensaje: ev.id });
      }
    }
    return json({ ok: true });
  } catch (e) {
    await repo.registrarError('webhook', e).catch(() => {});
    return json({ error: 'interno' }, 500); // 360dialog reintenta; los duplicados se ignoran
  }
};

export const config = { path: '/webhook/whatsapp' };
