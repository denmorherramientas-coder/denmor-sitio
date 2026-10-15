// Memoria de las pláticas de WhatsApp (Netlify Blobs) y registro de pedidos en el mismo lugar que usa el panel.
import { getStore } from '@netlify/blobs';
import { enviarTexto } from './whatsapp.mjs';

export const store = () => getStore('whatsapp');
const MAX_MSGS = 40;
const limpiarNum = (n) => String(n || '').replace(/\D/g, '');

export async function leerChat(wa) {
  const c = await store().get('chat/' + limpiarNum(wa), { type: 'json' }).catch(() => null);
  return c || { wa: limpiarNum(wa), nombre: '', msgs: [], pausaHasta: 0, ultimoEntrante: 0, ultimoId: '' };
}

export async function guardarChat(c) {
  c.msgs = c.msgs.slice(-MAX_MSGS);
  await store().setJSON('chat/' + c.wa, c);
}

/** Evita procesar dos veces el mismo mensaje (Meta reintenta los webhooks). */
export async function yaVisto(id) {
  if (!id) return false;
  const s = store();
  const k = 'visto/' + String(id).replace(/[^A-Za-z0-9._=-]/g, '').slice(0, 180);
  if (await s.get(k)) return true;
  await s.set(k, '1');
  return false;
}

export const horasHumano = () => Math.max(1, +process.env.WA_HUMANO_HORAS || 12);

export async function pausar(c, motivo) {
  c.pausaHasta = Date.now() + horasHumano() * 3600e3;
  c.motivoPausa = String(motivo || '').slice(0, 200);
  const aviso = limpiarNum(process.env.WA_AVISO_NUMERO);
  if (aviso && aviso !== c.wa) {
    // Solo llega si ese número le escribió al WhatsApp de la tienda en las últimas 24 h (regla de Meta).
    try { await enviarTexto(aviso, `🔔 ${c.nombre || 'Un cliente'} (+${c.wa}) necesita que lo atiendas.\nMotivo: ${c.motivoPausa || 'pidió hablar con alguien'}\nAbrir chat: https://wa.me/${c.wa}`); } catch (e) { console.warn('aviso no enviado', e.message); }
  }
}

function rid(n = 8) {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(n))].map((x) => a[x % a.length]).join('');
}

/** Guarda el pedido con el mismo formato que los pedidos de la página, para que aparezca en el panel. */
export async function registrarPedido(c, d) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chihuahua', year: '2-digit', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/-/g, '');
  const folio = `DN-${hoy}-W${String(Math.floor(100 + Math.random() * 900))}`;
  const id = `${folio}-${rid()}`;
  const ahora = new Date().toISOString();
  const total = d.items.reduce((s, x) => s + x.precio * x.cant, 0);
  const rec = {
    id, folio, creado: ahora, enviado: true, enviadoEn: ahora, estado: 'nuevo', nota_interna: '', total_final: 0, pdf: false, origen: 'whatsapp',
    historial: [{ t: ahora, txt: 'Pedido tomado por el asistente de WhatsApp' }],
    datos: {
      cliente: { nombre: String(d.nombre_cliente || c.nombre || '').slice(0, 80), tel: '+' + c.wa },
      entrega: { tipo: d.entrega === 'envio' ? 'envio' : 'tienda', calle: String(d.direccion || '').slice(0, 120), col: '', ciudad: '', estado: '', cp: '', ref: '' },
      items: d.items, total, ahorro: 0, nota: String(d.nota || '').slice(0, 600), promo: '', distribuidor: false,
    },
  };
  await getStore('pedidos-registro').setJSON(id, rec);
  return folio;
}
