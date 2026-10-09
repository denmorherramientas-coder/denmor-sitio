// WhatsApp Business Platform a través de 360dialog (Cloud API, coexistencia con la app WhatsApp Business).
//
// Seguridad de envío:
//  - Si WHATSAPP_ENVIO_HABILITADO no vale "si", NO se envía nada a WhatsApp: los mensajes quedan como "simulado".
//  - Si WHATSAPP_NUMEROS_PRUEBA tiene números (separados por comas), solo se envía a esos números (pruebas controladas).
import { enmascararTelefono } from '../seguridad.js';

export const BASE_360 = 'https://waba-v2.360dialog.io';

export function modoEnvio() {
  const habilitado = process.env.WHATSAPP_ENVIO_HABILITADO === 'si' && !!process.env.D360_API_KEY;
  const prueba = String(process.env.WHATSAPP_NUMEROS_PRUEBA || '').split(',').map((x) => x.replace(/\D/g, '')).filter(Boolean);
  return { habilitado, soloNumeros: prueba };
}

export function clienteWhatsApp({ fetchImpl = fetch, apiKey = process.env.D360_API_KEY, modo = modoEnvio() } = {}) {
  async function llamar(ruta, cuerpo) {
    const r = await fetchImpl(BASE_360 + ruta, {
      method: 'POST',
      headers: { 'D360-API-KEY': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    let j = {};
    try { j = await r.json(); } catch {}
    if (!r.ok) {
      const e = j?.error || j?.errors?.[0] || {};
      const err = new Error(`360dialog ${r.status}${e.code ? ` (código ${e.code})` : ''}: ${e.message || e.title || 'error'}`);
      err.codigo = e.code;
      throw err;
    }
    return j;
  }

  const permitido = (to) => modo.habilitado && (!modo.soloNumeros.length || modo.soloNumeros.includes(String(to).replace(/\D/g, '')));

  return {
    modo,
    // Envía un texto. Devuelve { id, simulado }
    async enviarTexto(to, texto) {
      if (!permitido(to)) return { id: null, simulado: true, motivo: modo.habilitado ? `número ${enmascararTelefono(to)} fuera de la lista de prueba` : 'envío deshabilitado' };
      const j = await llamar('/messages', { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to), type: 'text', text: { body: String(texto).slice(0, 4096), preview_url: true } });
      return { id: j?.messages?.[0]?.id || null, simulado: false };
    },
    // Marca como leído y muestra "escribiendo…" (dura hasta 25 s o hasta que se envía la respuesta)
    async escribiendo(messageId) {
      if (!modo.habilitado || !messageId || String(messageId).startsWith('sim')) return false;
      await llamar('/messages', { messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } });
      return true;
    },
    // Registra la dirección del webhook en 360dialog (con el encabezado secreto)
    async configurarWebhook(url, secreto) {
      return llamar('/v1/configs/webhook', { url, headers: { 'x-denmor-secreto': secreto } });
    },
  };
}

/* ---------------- lectura de avisos (webhooks) ---------------- */

function textoDeMensaje(m) {
  switch (m.type) {
    case 'text': return m.text?.body || '';
    case 'button': return m.button?.text || '';
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '[respuesta interactiva]';
    case 'image': return `[El cliente envió una imagen]${m.image?.caption ? ' ' + m.image.caption : ''}`;
    case 'video': return `[El cliente envió un video]${m.video?.caption ? ' ' + m.video.caption : ''}`;
    case 'document': return `[El cliente envió un documento${m.document?.filename ? ': ' + m.document.filename : ''}]${m.document?.caption ? ' ' + m.document.caption : ''}`;
    case 'audio': return '[El cliente envió un audio (nota de voz)]';
    case 'sticker': return '[El cliente envió un sticker]';
    case 'location': return `[El cliente compartió una ubicación${m.location?.name ? ': ' + m.location.name : ''}]`;
    case 'contacts': return '[El cliente compartió un contacto]';
    case 'reaction': return null; // las reacciones no se responden
    default: return `[Mensaje de tipo ${m.type}]`;
  }
}

const fechaDe = (ts) => (ts ? new Date(+ts * 1000) : new Date());

/**
 * Convierte el aviso de WhatsApp (formato Cloud API que reenvía 360dialog) en eventos simples.
 * Tipos: mensaje (del cliente), eco (lo escribiste desde la app WhatsApp Business), estado (entregado/leído/falló).
 */
export function leerWebhook(body) {
  const eventos = [];
  const cambios = [];
  if (body && Array.isArray(body.entry)) for (const e of body.entry) for (const c of e.changes || []) cambios.push(c);
  else if (body && (body.messages || body.statuses || body.message_echoes)) cambios.push({ field: body.message_echoes ? 'smb_message_echoes' : 'messages', value: body });
  for (const c of cambios) {
    const v = c.value || {};
    if (c.field === 'smb_message_echoes' || Array.isArray(v.message_echoes)) {
      for (const m of v.message_echoes || []) {
        if (m.type === 'reaction') continue;
        eventos.push({ tipo: 'eco', waIdCliente: String(m.to || ''), id: m.id, fecha: fechaDe(m.timestamp), tipoMensaje: m.type, texto: textoDeMensaje(m) ?? '' });
      }
      continue;
    }
    const nombres = Object.fromEntries((v.contacts || []).map((k) => [k.wa_id, k.profile?.name || null]));
    for (const m of v.messages || []) {
      const texto = textoDeMensaje(m);
      if (texto === null) continue;
      eventos.push({ tipo: 'mensaje', waId: String(m.from), nombre: nombres[m.from] || null, id: m.id, fecha: fechaDe(m.timestamp), tipoMensaje: m.type, texto });
    }
    for (const s of v.statuses || []) {
      const err = s.errors?.[0];
      eventos.push({ tipo: 'estado', id: s.id, estado: s.status, error: err ? `${err.code || ''} ${err.title || err.message || ''}`.trim() : null });
    }
  }
  return eventos;
}
