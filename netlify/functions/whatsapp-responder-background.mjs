// Asistente de WhatsApp (función en segundo plano, hasta 15 min).
// Espera ~30 s desde el último mensaje del cliente, muestra "escribiendo…", arma la respuesta y la manda
// en uno o varios mensajes cortos, como lo haría una persona.
import { leerChat, guardarChat, pausar, registrarPedido } from '../wa/chats.mjs';
import { escribiendo, enviarTexto } from '../wa/whatsapp.mjs';
import { responder } from '../wa/cerebro.mjs';

const dormir = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const azar = (a, b) => a + Math.random() * (b - a);

export async function atender({ wa, ts }, dep = {}) {
  const leer = dep.leerChat || leerChat, guardar = dep.guardarChat || guardarChat;
  const typing = dep.escribiendo || escribiendo, enviar = dep.enviarTexto || enviarTexto, dormirF = dep.dormir || dormir;
  const espera = Math.max(5, +process.env.WA_ESPERA_SEG || 30) * 1000;

  // 1) Esperar a que el cliente termine de escribir (≈30 s desde su último mensaje, con un poco de variación)
  await dormirF(ts + espera + azar(-3000, 4000) - Date.now() - 6000);
  let c = await leer(wa);
  if ((c.ultimoEntrante || 0) > ts) return 'llegó otro mensaje: lo atiende la llamada más nueva';
  if ((c.pausaHasta || 0) > Date.now()) return 'chat atendido por una persona';

  // 2) "escribiendo…" y armar la respuesta
  await typing(c.ultimoId);
  const inicio = Date.now();
  const r = await responder(c.msgs, {
    registrarPedido: (d) => (dep.registrarPedido || registrarPedido)(c, d),
    pasarAPersona: async (motivo) => { await (dep.pausar || pausar)(c, motivo); },
  }, dep.cerebro || {});
  if (!r.texto) { if (r.acciones.length) await guardar(c); return 'sin texto'; }

  // 3) Si mientras pensaba llegó otro mensaje, se descarta (la llamada nueva contesta todo junto)
  const fresco = await leer(wa);
  if ((fresco.ultimoEntrante || 0) > ts) return 'descartado: llegó otro mensaje';
  if ((fresco.pausaHasta || 0) > Date.now() && !r.acciones.some((a) => a.tipo === 'persona')) return 'descartado: ya contestó una persona';
  c = { ...fresco, pausaHasta: Math.max(fresco.pausaHasta || 0, c.pausaHasta || 0), motivoPausa: c.motivoPausa || fresco.motivoPausa };

  // 4) Mandar en partes cortas, con una pausa de "tecleo" proporcional al largo
  const partes = r.texto.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const msgs = partes.length > 3 ? [...partes.slice(0, 2), partes.slice(2).join('\n\n')] : partes;
  const pensado = Date.now() - inicio;
  for (let i = 0; i < msgs.length; i++) {
    const tecleo = Math.min(7000, 1200 + msgs[i].length * 35);
    await dormirF(i === 0 ? tecleo - pensado : tecleo);
    if (i > 0) await typing(c.ultimoId);
    await enviar(wa, msgs[i]);
    c.msgs.push({ r: 'b', t: msgs[i], ts: Date.now() });
  }
  await guardar(c);
  return 'contestado';
}

export default async (req) => {
  if ((req.headers.get('x-wa-clave') || '') !== (process.env.WA_VERIFY_TOKEN || '') || !process.env.WA_VERIFY_TOKEN) return;
  let b; try { b = await req.json(); } catch (e) { return; }
  if (!b || !b.wa || !b.ts) return;
  try { console.log('whatsapp', b.wa.slice(-4), await atender(b)); }
  catch (e) { console.error('asistente WhatsApp', e); }
};
