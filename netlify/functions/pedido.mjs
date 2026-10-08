// Pedidos de la tienda: guarda el PDF y los datos de cada pedido, y los entrega al panel.
//
// Público (lo usa la página del catálogo):
//   POST /api/pedido            { folio, pdf (base64), datos }  → { id, url }   guarda PDF + registro
//   POST /api/pedido/enviado    { id }                           → { ok }        el cliente tocó "Enviar por WhatsApp"
//   GET  /pedido/<id>.pdf                                        → el PDF (enlace que va en el mensaje de WhatsApp)
//
// Solo panel (encabezado Authorization: Bearer <token de GitHub del panel>):
//   GET    /api/pedidos?n=150&antes=<id>   → { pedidos:[…], mas:true|false }
//   PATCH  /api/pedidos/<id>  { estado, nota, total_final }  → { pedido }
//   DELETE /api/pedidos/<id>                                   → { ok }
//
// El token se comprueba contra GitHub: debe tener permiso de escritura en el repositorio de ajustes
// (el mismo que usa el panel para "Guardar y publicar"). No hay que configurar nada más en Netlify.
import { getStore } from '@netlify/blobs';

const REPO = process.env.DENMOR_REPO || 'denmorherramientas-coder/denmor-ajustes';
const MAX_PDF = 4 * 1024 * 1024; // 4 MB
const DIAS_PDF = 120; // el enlace público del PDF deja de funcionar después de estos días (el registro se queda)
const ESTADOS = ['nuevo', 'seguimiento', 'apartado', 'vendido', 'cancelado'];

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const txt = (t, s) => new Response(t, { status: s, headers: { 'content-type': 'text/plain; charset=utf-8' } });

function rid(n = 10) {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(n))].map((x) => a[x % a.length]).join('');
}
const okId = (id) => /^[A-Za-z0-9-]{6,60}$/.test(id || '');
const clip = (s, n) => String(s ?? '').slice(0, n);

/* ---------- autorización del panel ---------- */
const authCache = new Map(); // sha256(token) → vence
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
  const exp = authCache.get(h);
  if (exp && exp > Date.now()) return true;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { authorization: 'Bearer ' + m[1], accept: 'application/vnd.github+json', 'user-agent': 'denmor-panel' },
    });
    if (!r.ok) return false;
    const j = await r.json();
    if (!(j.permissions && (j.permissions.push || j.permissions.admin))) return false;
    authCache.set(h, Date.now() + 10 * 60 * 1000);
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- limpieza de los datos que manda la página ---------- */
function limpiarDatos(d) {
  d = d && typeof d === 'object' ? d : {};
  const c = d.cliente || {}, e = d.entrega || {};
  return {
    cliente: { nombre: clip(c.nombre, 80), tel: clip(c.tel, 30) },
    entrega: {
      tipo: e.tipo === 'envio' ? 'envio' : 'tienda',
      calle: clip(e.calle, 120), col: clip(e.col, 80), ciudad: clip(e.ciudad, 60), estado: clip(e.estado, 40), cp: clip(e.cp, 10), ref: clip(e.ref, 120),
    },
    items: (Array.isArray(d.items) ? d.items : []).slice(0, 60).map((x) => ({
      sku: clip(x.sku, 40), nombre: clip(x.nombre, 160), cond: clip(x.cond, 4), cant: Math.max(1, Math.min(999, +x.cant || 1)), precio: Math.max(0, +x.precio || 0),
    })),
    total: Math.max(0, +d.total || 0),
    ahorro: Math.max(0, +d.ahorro || 0),
    nota: clip(d.nota, 600),
    promo: clip(d.promo, 80),
    distribuidor: !!d.distribuidor,
  };
}

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const pdfs = getStore('pedidos');
  const reg = getStore('pedidos-registro');

  /* ===== público ===== */
  if (req.method === 'POST' && path === '/api/pedido') {
    const origin = req.headers.get('origin') || '';
    if (origin && !/^https:\/\/([a-z0-9-]+\.)*(denmorherramientas\.com|netlify\.app)$/i.test(origin)) return json({ error: 'origen' }, 403);
    if (+(req.headers.get('content-length') || 0) > MAX_PDF * 1.4 + 200000) return json({ error: 'grande' }, 413);
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: 'formato' }, 400); }
    const folio = clip(String(body.folio || '').replace(/[^A-Za-z0-9-]/g, ''), 24) || 'DN';
    const id = `${folio}-${rid()}`;
    let pdfOk = false;
    if (typeof body.pdf === 'string' && body.pdf.length > 100) {
      let buf;
      try { buf = Uint8Array.from(atob(body.pdf), (c) => c.charCodeAt(0)); } catch (e) { buf = null; }
      if (buf && buf.length <= MAX_PDF && String.fromCharCode(...buf.slice(0, 5)) === '%PDF-') {
        await pdfs.set(id, buf, { metadata: { t: Date.now() } });
        pdfOk = true;
      }
    }
    const ahora = new Date().toISOString();
    const rec = { id, folio, creado: ahora, enviado: false, enviadoEn: '', estado: 'nuevo', nota_interna: '', total_final: 0, pdf: pdfOk, historial: [{ t: ahora, txt: 'Pedido creado en la página' }], datos: limpiarDatos(body.datos) };
    await reg.setJSON(id, rec);
    return json({ id, url: pdfOk ? `${url.origin}/pedido/${id}.pdf` : '' });
  }

  if (req.method === 'POST' && path === '/api/pedido/enviado') {
    let body = {};
    try { body = await req.json(); } catch (e) {}
    if (!okId(body.id)) return json({ error: 'id' }, 400);
    const rec = await reg.get(body.id, { type: 'json' });
    if (!rec) return json({ error: 'no existe' }, 404);
    if (!rec.enviado) {
      rec.enviado = true; rec.enviadoEn = new Date().toISOString();
      rec.historial.push({ t: rec.enviadoEn, txt: 'El cliente abrió WhatsApp para enviar' });
      await reg.setJSON(body.id, rec);
    }
    return json({ ok: true });
  }

  if (req.method === 'GET' && path.startsWith('/pedido/')) {
    const id = decodeURIComponent(path.slice(8)).replace(/\.pdf$/i, '');
    if (!okId(id)) return txt('No encontrado', 404);
    const r = await pdfs.getWithMetadata(id, { type: 'arrayBuffer' });
    if (!r) return txt('Este pedido ya no está disponible.', 404);
    if (r.metadata && r.metadata.t && Date.now() - r.metadata.t > DIAS_PDF * 864e5) return txt('Este enlace ya expiró. Pide tu pedido a Denmor por WhatsApp.', 410);
    return new Response(r.data, {
      headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="Pedido-Denmor-${id.split('-').slice(0, 3).join('-')}.pdf"`, 'cache-control': 'private, max-age=3600', 'x-robots-tag': 'noindex' },
    });
  }

  /* ===== panel ===== */
  if (path === '/api/pedidos' || path.startsWith('/api/pedidos/')) {
    if (!(await autorizado(req))) return json({ error: 'sin permiso' }, 401);

    if (req.method === 'GET' && path === '/api/pedidos') {
      const n = Math.max(1, Math.min(500, +url.searchParams.get('n') || 150));
      const antes = url.searchParams.get('antes') || '';
      const keys = [];
      for await (const page of reg.list({ paginate: true })) for (const b of page.blobs) keys.push(b.key);
      keys.sort().reverse(); // el folio lleva la fecha (DN-AAMMDD-…): lo más nuevo primero
      const desde = antes ? keys.findIndex((k) => k < antes) : 0;
      const slice = desde < 0 ? [] : keys.slice(desde, desde + n);
      const pedidos = (await Promise.all(slice.map((k) => reg.get(k, { type: 'json' }).catch(() => null)))).filter(Boolean);
      pedidos.sort((x, y) => String(y.creado).localeCompare(String(x.creado)));
      return json({ pedidos, mas: desde >= 0 && desde + n < keys.length, total: keys.length });
    }

    const id = decodeURIComponent(path.slice('/api/pedidos/'.length));
    if (!okId(id)) return json({ error: 'id' }, 400);

    if (req.method === 'PATCH') {
      const rec = await reg.get(id, { type: 'json' });
      if (!rec) return json({ error: 'no existe' }, 404);
      let b = {};
      try { b = await req.json(); } catch (e) {}
      const t = new Date().toISOString(); const cambios = [];
      if (b.estado && ESTADOS.includes(b.estado) && b.estado !== rec.estado) { cambios.push(`Estado: ${rec.estado} → ${b.estado}`); rec.estado = b.estado; }
      if (typeof b.nota === 'string' && b.nota !== rec.nota_interna) { rec.nota_interna = clip(b.nota, 2000); cambios.push('Nota actualizada'); }
      if (b.total_final != null && +b.total_final !== +rec.total_final) { rec.total_final = Math.max(0, +b.total_final || 0); cambios.push(`Total final: $${rec.total_final}`); }
      if (cambios.length) { rec.historial.push({ t, txt: cambios.join(' · ') }); rec.actualizado = t; await reg.setJSON(id, rec); }
      return json({ pedido: rec });
    }

    if (req.method === 'DELETE') {
      await Promise.all([reg.delete(id), pdfs.delete(id)]);
      return json({ ok: true });
    }
  }

  return txt('No encontrado', 404);
};

export const config = { path: ['/api/pedido', '/api/pedido/enviado', '/api/pedidos', '/api/pedidos/*', '/pedido/*'] };
