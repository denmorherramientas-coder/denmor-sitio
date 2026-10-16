// Catálogo para el asistente de WhatsApp: mismos datos y mismas reglas de precio que la página (index.html).
//   core.json      → modelos, calificaciones y precios base (de makmex.com, el CEDIS)
//   ajustes.json   → ajustes de precio de Denmor y promoción (panel)
//   existencias    → existencias en vivo por tienda (robot de Nube SICAR)
// Se guarda en memoria 10 minutos para no descargar todo en cada mensaje.

const URL_CORE = process.env.WA_URL_CORE || 'https://makmex.com/core.json';
const URL_AJUSTES = process.env.WA_URL_AJUSTES || 'https://raw.githubusercontent.com/denmorherramientas-coder/denmor-ajustes/main/ajustes.json';
const URL_EXIST = process.env.WA_URL_EXISTENCIAS || 'https://raw.githubusercontent.com/makmexchihuahua-hub/makmex-existencias/main/existencias.json';
const URL_EXIST_2 = 'https://makmex.com/existencias.json';
const URL_DETALLE = process.env.WA_URL_DETALLE || 'https://makmex.com/detail-{b}.json';
const SITE = 'https://denmorherramientas.com';
const CACHE_MS = 10 * 60 * 1000;
const enc = (s) => (/^[A-Za-z0-9._~-]+$/.test(s) ? s : String(s).replace(/[^A-Za-z0-9._~-]/g, '-'));
/** Link del producto en la página: WhatsApp le pone la foto y el nombre (función producto-og). */
export const linkProducto = (modelo) => `${SITE}/p/${enc(modelo)}/`;
export const GRADE_NOTE = { AA: 'Totalmente nuevo, en su caja sellada.', A: '100 % nuevo, sin caja; sin raspones ni señales de uso.', B: 'Sin uso. Puede traer 1 a 3 detalles mínimos del traslado. Sin manchas.', C: 'Sí se usó: ligeramente manchado o raspado. Probado, funciona perfectamente.', D: 'Usado, con detalles estéticos marcados. Probado, funciona perfectamente.', E: 'Muy usado, varios detalles estéticos fuertes. Probado y funcionando.', F: 'Muy usado, remate. Se probó y funciona.' };

export const GRADE_TXT = { AA: 'Nuevo en caja', A: 'Nuevo sin caja', B: 'Como nuevo, sin caja', C: 'Semi nuevo, con uso', D: 'Usado', E: 'Muy usado', F: 'Muy usado (remate)' };
const VENDIBLES = new Set(['AA', 'A', 'B', 'C']);
const CARGADORES = [['48-59-1812', '48-59-1808', '48-59-1802', '48-59-1806', '48-59-1807', '48-59-1809', '48-59-1811'], ['48-59-2401', '48-59-1812', '48-59-1807', '48-59-1806', '48-59-2402'], ['DCB115', 'DCB112', 'DCB107', 'DCB1102', 'DCB1104', 'DCB1106', 'DCB118', 'DCB102', 'DCB104', 'DCB1112'], ['PCG002', 'P118B', 'P118', 'PCG005', 'P117', 'P135', 'PCG006'], ['OP404', 'OP401', 'OP406', 'OP403', 'OP40'], ['AC86093N', 'AC840095', 'R840095', 'R840094', 'R840091']];

export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

let cache = null; // { t, productos, promo }

async function getJSON(url) {
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { headers: { 'user-agent': 'denmor-whatsapp' } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

function chNow() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chihuahua', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const o = {}; f.forEach((x) => (o[x.type] = x.value));
  return { d: `${o.year}-${o.month}-${o.day}`, m: (+o.hour % 24) * 60 + +o.minute };
}
const hm = (t) => { const r = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return r ? +r[1] * 60 + +r[2] : null; };

function promoActiva(AJ) {
  const P = Object.assign({ activo: false, pct: 0 }, AJ.promo || {});
  const pc = +P.pct || 0;
  if (!P.activo || pc <= 0 || pc >= 90) return null;
  const n = chNow();
  if (P.desde && n.d < P.desde) return null;
  if (P.hasta && n.d > P.hasta) return null;
  const a = hm(P.horaIni), b = hm(P.horaFin);
  if (a != null && b != null) { const dentro = a <= b ? n.m >= a && n.m < b : n.m >= a || n.m < b; if (!dentro) return null; }
  return { pct: pc, nombre: P.nombre || '', hasta: P.hasta || '' };
}

/** Arma la lista de productos con precio público y existencia por tienda, igual que la página. */
export function armarCatalogo(core, AJ, ex) {
  AJ = AJ && typeof AJ === 'object' ? AJ : {};
  const P = core.rows.map((r) => { const o = {}; core.cols.forEach((c, j) => (o[c] = r[j])); o.st = Array.isArray(o.st) ? o.st.slice() : [0, 0, 0]; return o; });
  const bySku = new Map(P.map((p) => [p.sku, p]));
  // ajustes de precio (panel)
  const a = AJ.precios || {};
  const g = (k) => 1 + (+k || 0) / 100;
  const red = (x) => { const r = +a.redondeo || 10; return x > 0 ? Math.round(x / r) * r : x; };
  for (const p of P) {
    const b = norm(p.brand); const bk = ['milwaukee', 'dewalt', 'ryobi'].includes(b) ? b : 'otras';
    let f = g(a.global) * g((a.marcas || {})[bk]) * g((a.familias || {})[p.fam]) * g((a.modelos || {})[p.model]);
    const fx = +((a.fijos || {})[p.sku]) || 0;
    if (fx > 0 && p.p1 > 0) f = fx / p.p1;
    if (f !== 1) { for (const k of ['p1', 'p2', 'p3', 'disc']) if (p[k] > 0) p[k] = red(p[k] * f); if (fx > 0) p.p1 = fx; }
  }
  // promoción
  const promo = promoActiva(AJ);
  if (promo) { const f = 1 - promo.pct / 100; for (const p of P) { if (!(p.p1 > 0)) continue; const base = p.disc > 0 && p.disc < p.p1 ? p.disc : p.p1; p.disc = red(base * f); } }
  // existencias en vivo
  if (ex && ex.existencias) {
    const idx = {};
    for (const [id, nombre] of Object.entries(ex.sucursales || {})) { const n = String(nombre).toLowerCase(); if (/cedis|silvestre/.test(n)) idx[id] = 0; else if (/mart|denmor/.test(n)) idx[id] = 1; else if (/cdmx|naucalpan|m[eé]xico/.test(n)) idx[id] = 2; }
    const cols = Object.entries(idx);
    if (cols.length) {
      for (const p of P) { if (p.kit) continue; const e = ex.existencias[p.sku]; for (const [id, k] of cols) p.st[k] = e ? +e[id] || 0 : 0; }
      const cacheAv = new Map();
      const avail = (modelos) => { const key = modelos.join('|'); if (cacheAv.has(key)) return cacheAv.get(key); const t = [0, 0, 0]; for (const [sku, e] of Object.entries(ex.existencias)) { const i = sku.lastIndexOf('-'); if (i < 0) continue; if (!VENDIBLES.has(sku.slice(i + 1)) || !modelos.includes(sku.slice(0, i))) continue; for (const [id, k] of cols) t[k] += +e[id] || 0; } cacheAv.set(key, t); return t; };
      for (const p of P) {
        if (!p.kit) continue; const base = bySku.get(String(p.sku).split('-KIT')[0]); if (!base) continue;
        let st = base.st.slice();
        if (p.bat) { const b = avail([p.bat]); st = st.map((v, k) => Math.min(v, b[k])); }
        if (p.car) { const grp = CARGADORES.find((x) => x.includes(p.car)) || [p.car]; const c = avail(grp); st = st.map((v, k) => Math.min(v, c[k])); }
        p.st = st;
      }
    }
  }
  const ocultos = new Set(Array.isArray(AJ.ocultos) ? AJ.ocultos : []);
  const productos = P.filter((p) => !p.combo && !ocultos.has(p.model) && p.p1 > 0).map((p) => ({
    sku: p.sku, modelo: p.model, cal: p.grade || '', kit: !!p.kit, nombre: p.name, marca: p.brand, cat: p.cat || '', fam: p.fam || '',
    precio: p.disc > 0 && p.disc < p.p1 ? p.disc : p.p1, precioLista: p.p1, ah: p.ah || '',
    denmor: p.st[1] || 0, bodega1: p.st[0] || 0, cdmx: p.st[2] || 0,
    b: p.b, _txt: norm([p.name, p.model, p.sku, p.brand, p.cat, p.fam].join(' ')),
  }));
  const fichas = AJ.fichas && typeof AJ.fichas === 'object' ? AJ.fichas : {};
  return { productos, promo, fichas };
}

export async function cargarCatalogo() {
  if (cache && Date.now() - cache.t < CACHE_MS) return cache;
  const [core, AJ, ex] = await Promise.all([
    getJSON(URL_CORE),
    getJSON(URL_AJUSTES).catch(() => ({})),
    getJSON(URL_EXIST).catch(() => getJSON(URL_EXIST_2).catch(() => null)),
  ]);
  cache = { t: Date.now(), ...armarCatalogo(core, AJ, ex) };
  return cache;
}

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'y', 'a', 'un', 'una', 'en', 'por', 'que', 'mi', 'me', 'quiero', 'busco', 'necesito', 'tengo', 'ocupo', 'vendes', 'venden', 'tienen', 'tienes', 'hay', 'precio', 'cuanto', 'cuesta', 'sale', 'tiene', 'herramienta', 'o', 'se', 'su', 'sus']);
const SINON = { taladro: ['taladro', 'rotomartillo', 'drill'], rotomartillo: ['rotomartillo', 'sds', 'roto'], pistola: ['impacto', 'atornillador'], llave: ['llave', 'impacto'], esmeril: ['esmeriladora', 'esmeril', 'grinder'], esmeriladora: ['esmeriladora', 'esmeril'], sierra: ['sierra'], caladora: ['caladora', 'sierra'], multiherramienta: ['multiherramienta', 'oscilante', 'multi'], bateria: ['bateria', 'pila'], pila: ['bateria', 'pila'], cargador: ['cargador'], lijadora: ['lijadora'], clavadora: ['clavadora', 'brad', 'airstrike'], ingletadora: ['ingletadora', 'ingleteadora', 'inglete'], ingleteadora: ['ingletadora', 'ingleteadora'] };

/** Busca productos y agrupa por modelo. Devuelve texto corto para el asistente. */
export function buscar(cat, consulta, max = 6) {
  const q = norm(consulta).replace(/[^a-z0-9\-\s.]/g, ' ');
  const palabras = q.split(/\s+/).filter((w) => w && !STOP.has(w));
  if (!palabras.length) return { modelos: [] };
  const puntos = new Map();
  for (const p of cat.productos) {
    let s = 0;
    for (const w of palabras) {
      const mod = norm(p.modelo);
      if (mod === w || norm(p.sku) === w) s += 12;
      else if (w.length >= 3 && (mod.startsWith(w) || mod.replace(/-/g, '').startsWith(w.replace(/-/g, '')))) s += 8;
      else if (p._txt.includes(w)) s += w.length >= 4 ? 3 : 1.5;
      else if ((SINON[w] || []).some((x) => p._txt.includes(x))) s += 2;
      else if (/^m1[28]$|^20v$|^18v$|^fuel$/.test(w)) s -= 0.5;
    }
    if (s <= 0) continue;
    const prev = puntos.get(p.modelo) || { s: 0, vars: [] };
    prev.s = Math.max(prev.s, s); prev.vars.push(p); puntos.set(p.modelo, prev);
  }
  const orden = [...puntos.entries()].map(([modelo, o]) => {
    const exist = o.vars.reduce((t, v) => t + v.denmor + v.bodega1 + v.cdmx, 0);
    return { modelo, s: o.s + (exist > 0 ? 1 : 0), vars: o.vars };
  }).sort((a, b) => b.s - a.s).slice(0, max);
  const GO = { AA: 0, A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 };
  return {
    modelos: orden.map(({ modelo, vars }) => ({
      modelo, link: linkProducto(modelo), nombre: vars[0].nombre.replace(/\s*\(kit\)\s*$/i, ''), marca: vars[0].marca,
      opciones: vars.sort((a, b) => ((b.denmor + b.bodega1 + b.cdmx > 0) - (a.denmor + a.bodega1 + a.cdmx > 0)) || (b.denmor > 0) - (a.denmor > 0) || (a.kit - b.kit) || (GO[a.cal] ?? 9) - (GO[b.cal] ?? 9)).map((v) => ({
        clave: v.sku, presentacion: v.kit ? `Kit con batería ${v.ah ? v.ah + '.0 Ah ' : ''}y cargador` : 'Solo herramienta',
        condicion: `${v.cal} · ${GRADE_TXT[v.cal] || ''}`, precio: v.precio, precio_antes: v.precio < v.precioLista ? v.precioLista : undefined,
        existencia: { denmor: v.denmor, bodega1_chihuahua: v.bodega1, cdmx: v.cdmx },
        ...(v.denmor + v.bodega1 + v.cdmx > 0 ? {} : { sin_existencia: 'Sobre pedido, 7 a 10 días' }),
      })),
    })),
  };
}

export function porClave(cat, clave) {
  const c = norm(clave);
  return cat.productos.find((p) => norm(p.sku) === c) || null;
}

// Descripciones de producto (las mismas que muestra la página al abrir un producto)
const detCache = new Map(); // b → { t, j }
async function detalle(b, sku) {
  if (b == null || !(+b >= 0)) return null;
  let c = detCache.get(b);
  if (!c || Date.now() - c.t > 60 * 60 * 1000) { c = { t: Date.now(), j: await getJSON(URL_DETALLE.replace('{b}', b)).catch(() => ({})) }; detCache.set(b, c); }
  return c.j[sku] || null;
}
const limpiarDesc = (t) => String(t || '').replace(/…\.+/g, '. ').replace(/\.{4,}/g, '. ')
  .replace(/^(NUEVO EN CAJA SELLADA|NUEVO SIN CAJA|COMO NUEVO[^.]*|SEMI NUEVO[^.]*|USADO[^.]*|MUY USADO[^.]*)CALIFICACI[ÓO]N [A-F]+\.?\s*/i, '').replace(/\s+/g, ' ').trim();

/** Ficha de un producto: descripción del catálogo, especificaciones cargadas en el panel, condición y link con foto. */
export async function ficha(cat, clave) {
  const c = norm(clave);
  const p = cat.productos.find((x) => norm(x.sku) === c) || cat.productos.find((x) => norm(x.modelo) === c);
  if (!p) return null;
  // la descripción vive en la variante sin kit; si es kit, se toma la herramienta sola de la misma condición
  const base = p.kit ? cat.productos.find((x) => !x.kit && x.modelo === p.modelo && x.cal === p.cal) || cat.productos.find((x) => !x.kit && x.modelo === p.modelo) || p : p;
  const det = await detalle(base.b, base.sku).catch(() => null);
  const txt = typeof det === 'string' ? det : det && (det.c || det.d || det.desc) || '';
  const own = cat.fichas && cat.fichas[p.modelo];
  const especificaciones = Array.isArray(own) ? own.filter((r) => Array.isArray(r) && r[0] && r[1]).map((r) => `${r[0]}: ${r[1]}`) : [];
  return {
    clave: p.sku, modelo: p.modelo, nombre: p.nombre, marca: p.marca, link: linkProducto(p.modelo),
    condicion: `${p.cal} · ${GRADE_TXT[p.cal] || ''}. ${GRADE_NOTE[p.cal] || ''}`.trim(),
    presentacion: p.kit ? `Kit con batería ${p.ah ? p.ah + '.0 Ah ' : ''}y cargador` : 'Solo herramienta (sin batería ni cargador)',
    precio: p.precio, existencia: { denmor: p.denmor, bodega1_chihuahua: p.bodega1, cdmx: p.cdmx },
    especificaciones, descripcion: limpiarDesc(txt).slice(0, 1500) || 'Sin descripción en el catálogo.',
  };
}
