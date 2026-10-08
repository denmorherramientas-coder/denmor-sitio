// Imagen y título al compartir un producto (WhatsApp, Facebook, etc.)
// Los robots de WhatsApp/Facebook no ejecutan JavaScript, así que esta función escribe en el HTML
// el nombre y la foto del producto antes de entregarlo. Si algo falla, se entrega la página normal
// (con la imagen general de Denmor).
const SITE = 'https://denmorherramientas.com';
const CORE = 'https://makmex.com/core.json';
let cache = { t: 0, rows: null, cols: null };
const AJ_URL = 'https://raw.githubusercontent.com/denmorherramientas-coder/denmor-ajustes/main/ajustes.json';
let ajCache = { t: 0, j: {} };
async function ajustes() {
  if (Date.now() - ajCache.t < 10 * 60 * 1000) return ajCache.j;
  try { const r = await fetch(AJ_URL); ajCache = { t: Date.now(), j: r.ok ? await r.json() : {} }; } catch (e) { ajCache = { t: Date.now(), j: {} }; }
  return ajCache.j;
}

const v0model = (vars, ix) => vars[0][ix.model];
const enc = (s) => (/^[A-Za-z0-9._~-]+$/.test(s) ? s : String(s).replace(/[^A-Za-z0-9._~-]/g, '-'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GO = { AA: 0, A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 };

async function catalog() {
  if (cache.rows && Date.now() - cache.t < 10 * 60 * 1000) return cache;
  const r = await fetch(CORE, { headers: { 'user-agent': 'Denmor-OG' } });
  if (!r.ok) throw new Error('core ' + r.status);
  const j = await r.json();
  cache = { t: Date.now(), rows: j.rows, cols: j.cols };
  return cache;
}

function setMeta(html, attr, key, value) {
  const tag = `<meta ${attr}="${key}" content="${esc(value)}">`;
  const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[:.]/g, '\\$&')}"[^>]*>`, 'i');
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', tag + '</head>');
}

export default async (request, context) => {
  const res = await context.next();
  try {
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return res;
    const slug = decodeURIComponent(new URL(request.url).pathname.split('/')[2] || '');
    if (!slug) return res;
    const { rows, cols } = await catalog();
    const ix = Object.fromEntries(cols.map((c, i) => [c, i]));
    const vars = rows.filter((r) => enc(r[ix.model]) === slug);
    if (!vars.length) return res;
    const tot = (r) => (Array.isArray(r[ix.st]) ? r[ix.st].reduce((a, b) => a + (+b || 0), 0) : 0);
    vars.sort((a, b) => (tot(b) > 0) - (tot(a) > 0) || (a[ix.kit] || 0) - (b[ix.kit] || 0) || (GO[a[ix.grade]] ?? 9) - (GO[b[ix.grade]] ?? 9));
    // Primero la imagen de fábrica (las fotos reales "r…" se toman en el tapete con logo de Makmex)
    const all = vars.flatMap((r) => (Array.isArray(r[ix.pics]) ? r[ix.pics] : []).concat(r[ix.img] ? [r[ix.img]] : [])).filter(Boolean);
    const pic = all.find((id) => id[0] !== 'r') || all[0];
    const aj = await ajustes();
    const own = aj && aj.fotoUrl && typeof aj.fotoUrl[v0model(vars, ix)] === 'string' && /^https:\/\/[^\s"'<>]+$/.test(aj.fotoUrl[v0model(vars, ix)]) ? aj.fotoUrl[v0model(vars, ix)] : null;
    const v = vars[0];
    const model = v[ix.model], name = v[ix.name] || model, brand = v[ix.brand] || '';
    const inStock = vars.some((r) => tot(r) > 0);
    const title = `${name} ${String(name).includes(model) ? '' : model} | Denmor Herramientas`.replace(/\s+/g, ' ');
    const desc = `${brand} ${model} · ${inStock ? 'Con existencia en Chihuahua' : 'Sobre pedido 7–10 días'} · Nuevo y seminuevo calificado pieza por pieza · Envíos a todo México. Pide por WhatsApp 614 192 7887.`;
    const url = `${SITE}/p/${enc(model)}/`;
    const img = own || (pic ? `${SITE}/.netlify/images?url=${encodeURIComponent('https://makmex.com/img/' + pic + '.webp')}&fm=jpg&w=900&q=85` : `${SITE}/og-denmor.jpg`);

    let html = await res.text();
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${esc(title)}</title>`);
    html = html.replace(/<link rel="canonical" href="[^"]*">/i, `<link rel="canonical" href="${esc(url)}">`);
    html = setMeta(html, 'name', 'description', desc);
    html = setMeta(html, 'property', 'og:title', title);
    html = setMeta(html, 'property', 'og:description', desc);
    html = setMeta(html, 'property', 'og:url', url);
    html = setMeta(html, 'property', 'og:type', 'product');
    html = setMeta(html, 'property', 'og:image', img);
    html = setMeta(html, 'property', 'og:image:secure_url', img);
    html = setMeta(html, 'property', 'og:image:alt', name);
    html = html.replace(/<meta property="og:image:(width|height)"[^>]*>/gi, '');
    html = setMeta(html, 'name', 'twitter:image', img);
    html = setMeta(html, 'name', 'twitter:title', title);
    const h = new Headers(res.headers);
    h.delete('content-length');
    h.set('cache-control', 'public, max-age=0, must-revalidate');
    h.set('netlify-cdn-cache-control', 'public, max-age=600, stale-while-revalidate=3600');
    return new Response(html, { status: res.status, headers: h });
  } catch (e) {
    return res;
  }
};

export const config = { path: '/p/*' };
