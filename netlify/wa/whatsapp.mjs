// Envío de mensajes por la API de WhatsApp.
// Funciona con la API de Meta directa (WA_PROVEEDOR=meta) o con 360dialog (WA_PROVEEDOR=360dialog),
// que es uno de los proveedores autorizados que permiten seguir usando la app de WhatsApp Business con el mismo número.

const prov = () => (process.env.WA_PROVEEDOR || 'meta').toLowerCase();

function destino() {
  if (prov() === '360dialog') {
    return { url: 'https://waba-v2.360dialog.io/messages', headers: { 'D360-API-KEY': process.env.WA_360_KEY || '', 'content-type': 'application/json' } };
  }
  const v = process.env.WA_GRAPH_VERSION || 'v23.0';
  return { url: `https://graph.facebook.com/${v}/${process.env.WA_PHONE_ID}/messages`, headers: { authorization: 'Bearer ' + (process.env.WA_TOKEN || ''), 'content-type': 'application/json' } };
}

async function post(body) {
  const d = destino();
  const r = await fetch(d.url, { method: 'POST', headers: d.headers, body: JSON.stringify({ messaging_product: 'whatsapp', ...body }) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${txt.slice(0, 300)}`);
  try { return JSON.parse(txt); } catch (e) { return {}; }
}

/** Marca como leído y muestra "escribiendo…" (dura hasta 25 s o hasta que llega la respuesta). */
export async function escribiendo(messageId) {
  if (!messageId) return;
  try { await post({ status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }); }
  catch (e) { try { await post({ status: 'read', message_id: messageId }); } catch (_) {} }
}

export async function enviarTexto(to, texto) {
  return post({ recipient_type: 'individual', to, type: 'text', text: { preview_url: /https?:\/\//.test(String(texto)), body: String(texto).slice(0, 4000) } });
}

export const configurado = () => (prov() === '360dialog' ? !!process.env.WA_360_KEY : !!(process.env.WA_TOKEN && process.env.WA_PHONE_ID));
