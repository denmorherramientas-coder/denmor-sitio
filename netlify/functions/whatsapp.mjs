// Webhook de WhatsApp: recibe los mensajes de los clientes y deja la respuesta en manos del asistente,
// que contesta unos 30 segundos después (función en segundo plano whatsapp-responder-background).
//
//   GET  /api/whatsapp   → verificación del webhook (Meta manda hub.challenge)
//   POST /api/whatsapp   → mensajes nuevos, y "ecos" de lo que tú contestas desde la app (coexistencia)
//
// Variables en Netlify (Site configuration → Environment variables): ver LEEME-WHATSAPP.md
import { leerChat, guardarChat, yaVisto, horasHumano } from '../wa/chats.mjs';

const ok = (t = 'ok', s = 200) => new Response(t, { status: s, headers: { 'content-type': 'text/plain; charset=utf-8' } });

async function firmaValida(req, crudo) {
  const secreto = process.env.WA_APP_SECRET;
  if (!secreto) return true; // sin secreto configurado (p. ej. 360dialog) no se comprueba la firma
  const firma = (req.headers.get('x-hub-signature-256') || '').replace(/^sha256=/, '');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(crudo));
  const hex = [...new Uint8Array(mac)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return hex.length === firma.length && hex === firma;
}

function textoDe(m) {
  switch (m.type) {
    case 'text': return m.text?.body || '';
    case 'button': return m.button?.text || '';
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
    case 'image': return '[El cliente mandó una foto]' + (m.image?.caption ? ' ' + m.image.caption : '');
    case 'video': return '[El cliente mandó un video]' + (m.video?.caption ? ' ' + m.video.caption : '');
    case 'audio': return '[El cliente mandó una nota de voz]';
    case 'document': return '[El cliente mandó un documento]' + (m.document?.caption ? ' ' + m.document.caption : '');
    case 'location': return `[El cliente mandó su ubicación: ${m.location?.address || m.location?.name || ''}]`;
    case 'sticker': return '[Sticker]';
    default: return `[Mensaje tipo ${m.type}]`;
  }
}

const permitido = (wa) => {
  const lista = String(process.env.WA_PRUEBA_NUMEROS || '').split(/[,\s]+/).map((x) => x.replace(/\D/g, '')).filter(Boolean);
  return !lista.length || lista.includes(wa);
};

export default async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const modo = url.searchParams.get('hub.mode'), token = url.searchParams.get('hub.verify_token'), reto = url.searchParams.get('hub.challenge');
    if (modo === 'subscribe' && token && token === process.env.WA_VERIFY_TOKEN) return ok(reto || '');
    return ok('El webhook de WhatsApp de Denmor está en línea.', reto ? 403 : 200);
  }
  if (req.method !== 'POST') return ok('Método no permitido', 405);

  const crudo = await req.text();
  if (!(await firmaValida(req, crudo))) return ok('firma', 401);
  let body; try { body = JSON.parse(crudo); } catch (e) { return ok(); }

  const pendientes = new Map(); // wa → {ts}
  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};

      // Lo que contestas tú desde la app de WhatsApp Business: el asistente se calla en ese chat.
      if (ch.field === 'smb_message_echoes') {
        for (const e of v.message_echoes || []) {
          const wa = String(e.to || '').replace(/\D/g, ''); if (!wa) continue;
          const c = await leerChat(wa);
          c.msgs.push({ r: 'h', t: textoDe(e), ts: (+e.timestamp || Date.now() / 1000) * 1000 });
          c.pausaHasta = Date.now() + horasHumano() * 3600e3; c.motivoPausa = 'Contestó alguien del equipo';
          await guardarChat(c);
        }
        continue;
      }
      if (ch.field && ch.field !== 'messages') continue;

      const nombres = {}; for (const k of v.contacts || []) nombres[k.wa_id] = k.profile?.name || '';
      for (const m of v.messages || []) {
        const wa = String(m.from || '').replace(/\D/g, '');
        if (!wa || (await yaVisto(m.id))) continue;
        const ts = (+m.timestamp || Date.now() / 1000) * 1000;
        if (Date.now() - ts > 15 * 60 * 1000) continue; // mensaje viejo reenviado: no se contesta
        const c = await leerChat(wa);
        if (nombres[wa]) c.nombre = nombres[wa];
        c.msgs.push({ r: 'u', t: textoDe(m).slice(0, 2000), ts });
        c.ultimoEntrante = Math.max(c.ultimoEntrante || 0, ts); c.ultimoId = m.id;
        await guardarChat(c);
        if (process.env.WA_ACTIVO === '1' && permitido(wa)) pendientes.set(wa, { ts: c.ultimoEntrante });
      }
    }
  }

  // Avisar a la función en segundo plano (contesta ~30 s después; si llegan más mensajes, junta todo en una respuesta).
  const destino = new URL('/.netlify/functions/whatsapp-responder-background', url.origin);
  await Promise.all([...pendientes].map(([wa, p]) => fetch(destino, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-wa-clave': process.env.WA_VERIFY_TOKEN || '' }, body: JSON.stringify({ wa, ts: p.ts }),
  }).catch((e) => console.warn('no se pudo llamar al asistente', e.message))));

  return ok();
};

export const config = { path: '/api/whatsapp' };
