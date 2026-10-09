// Catálogo de Denmor tal como lo ve el cliente en denmorherramientas.com.
//
// Esta es una copia fiel de las reglas de index.html (funciones ajF/ajR/ajP, promoState, applyStock y price).
// Si cambian en index.html, hay que cambiarlas aquí también: la prueba tests/paridad-catalogo.test.js
// carga el index.html real en un navegador y compara precio y existencia producto por producto.
import { ZONA } from '../config.js';

export const GRADE_TXT = { AA: 'Nuevo en caja', A: 'Nuevo sin caja', B: 'Como nuevo · sin caja', C: 'Semi nuevo · con uso', D: 'Usado', E: 'Muy usado', F: 'Muy usado · remate', '': 'Combo' };
export const GRADE_NOTE = {
  AA: 'Totalmente nuevo, en su caja sellada.',
  A: '100 % nuevo, sin caja; sin raspones ni señales de uso.',
  B: 'Sin uso. Puede traer 1 a 3 detalles mínimos del traslado a Chihuahua. Sin manchas.',
  C: 'Sí se usó: ligeramente manchado o raspado. Probado, funciona perfectamente.',
  D: 'Usado, con detalles estéticos marcados. Probado, funciona perfectamente.',
  E: 'Muy usado, varios detalles estéticos fuertes. Probado y funcionando.',
  F: 'Muy usado, remate. Se probó y funciona.',
  '': '',
};
export const GO = { AA: 0, A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, '': 7 };
export const TIENDAS = ['Bodega 1 (Chihuahua)', 'Denmor · C. José Martí Pérez 3104 (Chihuahua)', 'Almacén CDMX'];

export const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const enc = (s) => (/^[A-Za-z0-9._~-]+$/.test(s) ? s : String(s).replace(/[^A-Za-z0-9._~-]/g, '-'));

// Cargadores equivalentes (mismo grupo = sirven para el mismo kit). Copiado de index.html → applyStock.
const CHG = [
  ['48-59-1812', '48-59-1808', '48-59-1802', '48-59-1806', '48-59-1807', '48-59-1809', '48-59-1811'],
  ['48-59-2401', '48-59-1812', '48-59-1807', '48-59-1806', '48-59-2402'],
  ['DCB115', 'DCB112', 'DCB107', 'DCB1102', 'DCB1104', 'DCB1106', 'DCB118', 'DCB102', 'DCB104', 'DCB1112'],
  ['PCG002', 'P118B', 'P118', 'PCG005', 'P117', 'P135', 'PCG006'],
  ['OP404', 'OP401', 'OP406', 'OP403', 'OP40'],
  ['AC86093N', 'AC840095', 'R840095', 'R840094', 'R840091'],
];

function horaChihuahua(ahora) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(ahora);
  const o = {};
  f.forEach((x) => (o[x.type] = x.value));
  return { d: `${o.year}-${o.month}-${o.day}`, m: (+o.hour % 24) * 60 + +o.minute, s: +o.second };
}
const hm = (t) => { const r = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return r ? +r[1] * 60 + +r[2] : null; };

// Promoción activa del panel (ajustes.promo). Igual a promoState() de index.html.
export function estadoPromo(AJ, ahora = new Date()) {
  const PROMO = Object.assign({ activo: false, pct: 0, nombre: 'Venta nocturna', desde: '', hasta: '', horaIni: '', horaFin: '' }, AJ.promo && typeof AJ.promo === 'object' ? AJ.promo : {});
  const pc = +PROMO.pct || 0;
  if (!PROMO.activo || pc <= 0 || pc >= 90) return null;
  const n = horaChihuahua(ahora);
  if (PROMO.desde && n.d < PROMO.desde) return null;
  if (PROMO.hasta && n.d > PROMO.hasta) return null;
  const a = hm(PROMO.horaIni), b = hm(PROMO.horaFin);
  if (a != null && b != null) {
    const inWin = a <= b ? n.m >= a && n.m < b : n.m >= a || n.m < b;
    if (!inWin) return { off: true, a, b, nombre: PROMO.nombre };
  }
  return { pct: pc, nombre: PROMO.nombre, hasta: PROMO.hasta || '', horaFin: PROMO.horaFin || '' };
}

// Mapea las sucursales de existencias.json a las 3 columnas del catálogo: 0 = Bodega 1, 1 = Denmor, 2 = CDMX
export function columnasSucursal(sucursales) {
  const idx = {};
  for (const [id, nombre] of Object.entries(sucursales || {})) {
    const n = String(nombre).toLowerCase();
    if (/cedis|silvestre/.test(n)) idx[id] = 0;
    else if (/mart|denmor/.test(n)) idx[id] = 1;
    else if (/cdmx|naucalpan|m[eé]xico/.test(n)) idx[id] = 2;
  }
  return Object.entries(idx);
}

/**
 * Construye el catálogo público.
 * @param {{cols:string[], rows:any[][], updated?:string}} core  core.json
 * @param {object} AJ  ajustes.json (panel de Denmor); {} si no se pudo leer
 * @param {object|null} ex  existencias.json (robot de SICAR); null si no se pudo leer
 */
export function construirCatalogo(core, AJ = {}, ex = null, ahora = new Date()) {
  AJ = AJ && typeof AJ === 'object' ? AJ : {};
  const P = core.rows.map((r, i) => {
    const o = {};
    core.cols.forEach((c, j) => (o[c] = r[j]));
    o.i = i;
    o.st = Array.isArray(o.st) ? o.st.slice(0, 3).map((x) => +x || 0) : [0, 0, 0];
    o.total = o.st[0] + o.st[1] + o.st[2];
    return o;
  });

  /* ajustes de precio del panel */
  const a = AJ.precios || {};
  const ajF = (brand, fam, model) => {
    const b = norm(brand || '');
    const bk = ['milwaukee', 'dewalt', 'ryobi'].includes(b) ? b : 'otras';
    const g = (k) => 1 + (+k || 0) / 100;
    return g(a.global) * g((a.marcas || {})[bk]) * g((a.familias || {})[fam]) * g((a.modelos || {})[model]);
  };
  const ajR = (x) => { const r = +a.redondeo || 10; return x > 0 ? Math.round(x / r) * r : x; };
  for (const p of P) {
    let f = ajF(p.brand, p.fam, p.model);
    const fx = +((a.fijos || {})[p.sku]) || 0;
    if (fx > 0 && p.p1 > 0) f = fx / p.p1;
    if (f === 1) continue;
    for (const k of ['p1', 'p2', 'p3', 'disc']) if (p[k] > 0) p[k] = ajR(p[k] * f);
    if (fx > 0) p.p1 = fx;
  }

  /* promoción */
  const PS = estadoPromo(AJ, ahora);
  const promoOn = !!(PS && !PS.off);
  if (promoOn) {
    const f = 1 - PS.pct / 100;
    for (const p of P) {
      if (!(p.p1 > 0)) continue;
      const base = p.disc > 0 && p.disc < p.p1 ? p.disc : p.p1;
      p.disc = ajR(base * f);
    }
  }

  /* existencias en vivo (applyStock) */
  let existencias = { aplicadas: false, actualizado: core.updated || '', motivo: 'sin archivo de existencias' };
  if (ex && ex.existencias) {
    const cols = columnasSucursal(ex.sucursales);
    if (cols.length) {
      // modelos con existencia = suma de sus variantes que no son kit (igual que deriveModels)
      const models = (lista) => { const t = new Map(); for (const p of lista) if (!p.kit) t.set(p.model, (t.get(p.model) || 0) + p.total); let n = 0; for (const v of t.values()) if (v > 0) n++; return n; };
      const before = models(P);
      const snapshot = P.map((p) => p.st.slice());
      for (const p of P) {
        if (p.kit) continue;
        const e = ex.existencias[p.sku];
        for (const [id, k] of cols) p.st[k] = e ? +e[id] || 0 : 0;
        p.total = p.st[0] + p.st[1] + p.st[2];
      }
      const SELL = new Set(['AA', 'A', 'B', 'C']);
      const availCache = new Map();
      const avail = (prefixes) => {
        const key = prefixes.join('|');
        if (availCache.has(key)) return availCache.get(key);
        const t = [0, 0, 0];
        for (const [sku, e] of Object.entries(ex.existencias)) {
          const i = sku.lastIndexOf('-');
          if (i < 0) continue;
          const model = sku.slice(0, i), g = sku.slice(i + 1);
          if (!SELL.has(g) || !prefixes.includes(model)) continue;
          for (const [id, k] of cols) t[k] += +e[id] || 0;
        }
        availCache.set(key, t);
        return t;
      };
      const bySku = new Map(P.map((p) => [p.sku, p]));
      for (const p of P) {
        if (!p.kit) continue;
        const base = bySku.get(p.sku.split('-KIT')[0]);
        if (!base) continue;
        let st = base.st.slice();
        if (p.bat) { const b = avail([p.bat]); st = st.map((v, k) => Math.min(v, b[k])); }
        if (p.car) { const grp = CHG.find((g) => g.includes(p.car)) || [p.car]; const c = avail(grp); st = st.map((v, k) => Math.min(v, c[k])); }
        p.st = st;
        p.total = st[0] + st[1] + st[2];
      }
      const after = models(P);
      if (after < before * 0.5) {
        P.forEach((p, i) => { p.st = snapshot[i]; p.total = p.st[0] + p.st[1] + p.st[2]; });
        existencias = { aplicadas: false, actualizado: core.updated || '', motivo: `archivo de existencias incompleto (modelos con existencia bajaron de ${before} a ${after}); se usan las del catálogo base` };
      } else {
        existencias = { aplicadas: true, actualizado: ex.actualizado || '', motivo: '' };
      }
    }
  }

  /* modelos */
  const ocultos = new Set(Array.isArray(AJ.ocultos) ? AJ.ocultos : []);
  const M = new Map();
  for (const p of P) {
    if (p.combo) continue; // los combos se arman con combos.json en el navegador; el asistente los pasa a un asesor
    let m = M.get(p.model);
    if (!m) { m = { model: p.model, brand: p.brand, cat: p.cat, fam: p.fam, vars: [], oculto: ocultos.has(p.model) }; M.set(p.model, m); }
    m.vars.push(p);
  }
  for (const m of M.values()) {
    m.vars.sort((x, y) => (x.kit - y.kit) || (GO[x.grade] - GO[y.grade]));
    const base = m.vars.find((v) => !v.kit) || m.vars[0];
    m.name = base.name;
    m.brand = m.brand || base.brand;
    m.stock = [0, 1, 2].map((k) => m.vars.reduce((s, v) => s + (v.kit ? 0 : v.st[k]), 0));
    m.total = m.stock[0] + m.stock[1] + m.stock[2];
  }
  return { P, M, bySku: new Map(P.map((p) => [p.sku, p])), promo: promoOn ? PS : null, existencias, actualizado: core.updated || '' };
}

// Precio que ve el público en la página (sin clave de distribuidor). Igual a price(v) de index.html.
export const precioPublico = (v) => v.disc || v.p1;
export const precioAntes = (v) => (v.disc && v.disc < v.p1 ? v.p1 : 0);
export const urlProducto = (sitio, model) => `${sitio.replace(/\/$/, '')}/p/${enc(model)}/`;

// Ficha resumida de una variante para el asistente (lo único que puede decir de precio y existencia)
export function fichaVariante(v) {
  const precio = precioPublico(v);
  return {
    clave: v.sku,
    condicion: v.combo ? 'Combo' : `${v.grade || ''} · ${GRADE_TXT[v.grade] || ''}`.trim(),
    nota_condicion: GRADE_NOTE[v.grade] || '',
    kit: !!v.kit,
    incluye_bateria: v.kit ? v.bat || '' : undefined,
    incluye_cargador: v.kit ? v.car || '' : undefined,
    precio: precio > 0 ? precio : null,
    precio_antes: precioAntes(v) || undefined,
    ahorro: precioAntes(v) ? precioAntes(v) - precio : undefined,
    existencia: { denmor_jose_marti: v.st[1], bodega_chihuahua: v.st[0], cdmx: v.st[2], total: v.total },
    disponibilidad: v.total > 0 ? (v.st[0] + v.st[1] > 0 ? 'En existencia en Chihuahua' : 'En existencia en CDMX (se envía)') : 'Por encargo · 7 a 10 días (lo confirma un asesor)',
  };
}
