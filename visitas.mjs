// Visitas del catálogo y estado del servidor.
//
// Público:
//   POST /api/visita   { vid, sid, pag, src, dev }  → { ok }   latido cada ~45 s mientras el catálogo está abierto
//   GET  /api/estado                                  → { ok, version, almacen }   ¿están instaladas las funciones?
// Solo panel (Authorization: Bearer <token de GitHub del panel>, igual que Pedidos):
//   GET  /api/visitas                                 → en vivo, hoy, últimos 30 días y total
//
// No se guarda nada personal: solo un número al azar por navegador, la página que ve (catálogo o modelo),
// de dónde llegó (Google, Facebook, WhatsApp…) y si es celular o computadora.
import { getStore } from '@netlify/blobs';

const VERSION = '2026-10-08';
const REPO = process.env.DENMOR_REPO || 'denmorherramientas-coder/denmor-ajustes';
const TZ = 'America/Chihuahua';
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const okTok = (s, n = 40) => (/^[A-Za-z0-9_-]{4,60}$/.test(String(s || '')) ? String(s).slice(0, n) : '');
const SRC = ['directo', 'google', 'facebook', 'instagram', 'whatsapp', 'tiktok', 'mercadolibre', 'otro'];
const DEV = ['cel', 'pc'];

function dia(t = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const minuto = (t = Date.now()) => Math.floor(t / 60000);

/* ---------- autorización (misma regla que Pedidos) ---------- */
const authCache = new Map();
async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function autorizado(req) {
  const key = process.env.DENMOR_PANEL_KEY;
  if (key && req.headers.get('x-panel-key') === key) return true;
  const m = /^Bearer\s+(\S{20,200})$/.exec(req.headers.get('authorization') || '');
  if (!m) return false;
  const h = await sha(m[1]);
  if ((authCache.get(h) || 0) > Date.now()) return true;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}`, { headers: { authorization: 'Bearer ' + m[1], accept: 'application/vnd.github+json', 'user-agent': 'denmor-panel' } });
    if (!r.ok) return false;
    const j = await r.json();
    if (!(j.permissions && (j.permissions.push || j.permissions.admin))) return false;
    authCache.set(h, Date.now() + 10 * 60 * 1000);
    return true;
  } catch (e) {
    return false;
  }
}

async function keys(store, prefix) {
  const out = [];
  for await (const page of store.list({ prefix, paginate: true })) for (const b of page.blobs) out.push(b.key);
  return out;
}

/* resumen de un día: visitantes únicos, por fuente, por dispositivo y productos más vistos */
async function resumenDia(store, d) {
  const vk = await keys(store, `dia/${d}/`); // dia/<d>/<src>/<dev>/<vid>
  const pk = await keys(store, `prod/${d}/`); // prod/<d>/<modelo>/<vid>
  const fuentes = {}, disp = {}, vis = new Set();
  for (const k of vk) {
    const [, , src, dev, vid] = k.split('/');
    if (vis.has(vid)) continue;
    vis.add(vid);
    fuentes[src] = (fuentes[src] || 0) + 1;
    disp[dev] = (disp[dev] || 0) + 1;
  }
  const prod = {};
  for (const k of pk) { const model = k.split('/')[2]; prod[model] = (prod[model] || 0) + 1; }
  const top = Object.entries(prod).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([m, n]) => ({ modelo: m, vistas: n }));
  return { dia: d, visitantes: vis.size, fuentes, dispositivos: disp, productos: top };
}

async function limpiarVivos(store) {
  const lim = minuto() - 5;
  const ks = await keys(store, 'vivo/');
  await Promise.all(ks.filter((k) => +k.split('/')[1] < lim).slice(0, 400).map((k) => store.delete(k).catch(() => {})));
}

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const store = getStore('visitas');

  if (path === '/api/estado' && req.method === 'GET') {
    let almacen = false;
    try {
      const salud = getStore('salud');
      const v = String(Date.now());
      await salud.set('ping', v);
      almacen = (await salud.get('ping')) === v;
    } catch (e) {}
    return json({ ok: true, version: VERSION, almacen, hora: new Date().toISOString() });
  }

  if (path === '/api/visita' && req.method === 'POST') {
    let b = {};
    try { b = await req.json(); } catch (e) {}
    const vid = okTok(b.vid), sid = okTok(b.sid);
    if (!vid || !sid) return json({ ok: false }, 400);
    const src = SRC.includes(b.src) ? b.src : 'otro';
    const dev = DEV.includes(b.dev) ? b.dev : 'pc';
    const pag = String(b.pag || 'catalogo').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40) || 'catalogo';
    const d = dia();
    const w = [store.set(`vivo/${minuto()}/${sid}__${pag}`, '1')];
    if (b.nueva) w.push(store.set(`dia/${d}/${src}/${dev}/${vid}`, '1'));
    if (pag !== 'catalogo' && b.nuevaPag) w.push(store.set(`prod/${d}/${pag}/${vid}`, '1'));
    await Promise.all(w);
    if (Math.random() < 0.03) limpiarVivos(store).catch(() => {});
    return json({ ok: true });
  }

  if (path === '/api/visitas' && req.method === 'GET') {
    if (!(await autorizado(req))) return json({ error: 'sin permiso' }, 401);
    const m = minuto();
    // en vivo: quien mandó latido en el minuto actual o el anterior
    const vivosK = (await Promise.all([keys(store, `vivo/${m}/`), keys(store, `vivo/${m - 1}/`)])).flat();
    const porSid = new Map();
    for (const k of vivosK) { const [, min, rest] = k.split('/'); const [sid, pag] = rest.split('__'); const prev = porSid.get(sid); if (!prev || +min > prev.min) porSid.set(sid, { min: +min, pag }); }
    const paginas = {};
    for (const { pag } of porSid.values()) paginas[pag] = (paginas[pag] || 0) + 1;

    const hoy = dia();
    const hoyRes = await resumenDia(store, hoy);
    // días anteriores: se calculan una vez y se guardan en resumen/<día>
    const dias = [];
    for (let i = 1; i <= 30; i++) dias.push(dia(Date.now() - i * 864e5));
    const prev = await Promise.all(dias.map(async (d) => {
      let r = await store.get(`resumen/${d}`, { type: 'json' }).catch(() => null);
      if (!r) { r = await resumenDia(store, d); await store.setJSON(`resumen/${d}`, r); }
      return r;
    }));
    // total histórico: suma de días cerrados (se va acumulando) + hoy
    let tot = (await store.get('resumen/total', { type: 'json' }).catch(() => null)) || { hasta: '', total: 0, desde: '' };
    const cerrados = prev.filter((r) => r.dia > tot.hasta).sort((a, b) => a.dia.localeCompare(b.dia));
    if (cerrados.length) {
      for (const r of cerrados) { tot.total += r.visitantes; if (!tot.desde && r.visitantes) tot.desde = r.dia; }
      tot.hasta = cerrados[cerrados.length - 1].dia;
      await store.setJSON('resumen/total', tot);
    }
    if (!tot.desde && hoyRes.visitantes) tot.desde = hoy;
    return json({
      vivo: { personas: porSid.size, paginas },
      hoy: hoyRes,
      dias: prev.map((r) => ({ dia: r.dia, visitantes: r.visitantes })).reverse(),
      total: tot.total + hoyRes.visitantes,
      desde: tot.desde || hoy,
    });
  }

  return json({ error: 'no encontrado' }, 404);
};

export const config = { path: ['/api/visita', '/api/visitas', '/api/estado'] };
netlify/functions/
