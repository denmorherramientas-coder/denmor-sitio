// Lectura del catálogo publicado (la fuente autorizada de productos, precios y existencias) y búsqueda.
import { construirCatalogo, fichaVariante, precioPublico, urlProducto, norm, GO } from './modelo.js';

let cache = null; // { t, cat, ajustesBuenos }
let ultimoAjustesBueno = null;

async function traerJson(url, fetchImpl, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetchImpl(url + (url.includes('?') ? '&' : '?') + 't=' + Math.floor(Date.now() / 60000), { signal: ctl.signal, headers: { 'user-agent': 'Denmor-AI-Operations' } });
    if (!r.ok) throw new Error(`${r.status} al leer ${url.split('?')[0]}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Carga el catálogo con caché. Reglas de seguridad:
 *  - Sin core.json no hay catálogo (el asistente transfiere a un asesor).
 *  - Sin ajustes.json (y sin copia anterior) los precios NO son confiables: el asistente no da precios.
 *  - Sin existencias.json se usan las del catálogo base y se avisa que hay que confirmarlas.
 */
export async function cargarCatalogo(cfgCatalogo, { fetchImpl = fetch, forzar = false, ahora = new Date() } = {}) {
  const ttl = (cfgCatalogo.cache_minutos || 10) * 60000;
  if (!forzar && cache && Date.now() - cache.t < ttl) return cache.cat;
  const [core, aj, ex] = await Promise.allSettled([
    traerJson(cfgCatalogo.core, fetchImpl, 15000),
    traerJson(cfgCatalogo.ajustes, fetchImpl),
    traerJson(cfgCatalogo.existencias, fetchImpl),
  ]);
  if (core.status !== 'fulfilled' || !core.value || !Array.isArray(core.value.rows)) {
    if (cache) return cache.cat; // mejor el último catálogo bueno que nada
    throw new Error('No se pudo leer el catálogo (core.json): ' + (core.reason?.message || 'formato inválido'));
  }
  let ajustes = null;
  if (aj.status === 'fulfilled' && aj.value && typeof aj.value === 'object') ajustes = ultimoAjustesBueno = aj.value;
  else if (ultimoAjustesBueno) ajustes = ultimoAjustesBueno;
  const cat = construirCatalogo(core.value, ajustes || {}, ex.status === 'fulfilled' ? ex.value : null, ahora);
  cat.preciosConfiables = !!ajustes;
  cat.existenciasCrudas = ex.status === 'fulfilled' ? ex.value : null;
  cat.avisos = [];
  if (!ajustes) cat.avisos.push('No se pudieron leer los ajustes de precio del panel: los precios no son confiables.');
  if (!cat.existencias.aplicadas) cat.avisos.push('Existencias sin actualizar: ' + cat.existencias.motivo + '.');
  cat.sitio = cfgCatalogo.sitio;
  cat.detalleUrl = cfgCatalogo.detalle;
  cat.cargado = new Date().toISOString();
  cache = { t: Date.now(), cat };
  return cat;
}

export function olvidarCatalogo() {
  cache = null;
  ultimoAjustesBueno = null;
}

/* ---------------- búsqueda ---------------- */

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'y', 'a', 'un', 'una', 'en', 'por', 'que', 'mi', 'me', 'quiero', 'busco', 'necesito', 'tengo', 'ocupo', 'vendes', 'venden', 'tienen', 'tienes', 'hay', 'precio', 'cuanto', 'cuesta', 'sin', 'solo', 'herramienta']);
const MARCAS = { milwaukee: ['milwauke', 'milwokee', 'milwaki', 'miluaki', 'milwuakee', 'milwakee', 'm18', 'm12', 'fuel'], dewalt: ['de walt', 'dewal', 'dewolt', '20v max', 'flexvolt', 'atomic'], ryobi: ['riobi', 'ryoby', 'one+'], makita: ['maquita', 'lxt'], bosch: ['bosh'] };
const SIN = {
  rotomartillo: ['roto', 'rotomartillo', 'taladro percutor', 'martillo perforador', 'sds'],
  taladro: ['taladro', 'drill', 'atornillador', 'perforadora'],
  impacto: ['impacto', 'llave de impacto', 'pistola de impacto', 'matraca', 'ratchet'],
  esmeriladora: ['esmeriladora', 'pulidora', 'amoladora', 'esmeril', 'galletera'],
  sierra: ['sierra', 'segueta', 'caladora', 'circular', 'sable', 'cinta', 'ingleteadora'],
  bateria: ['bateria', 'pila', 'batería', 'ah'],
  cargador: ['cargador'],
  aspiradora: ['aspiradora'],
  lampara: ['lampara', 'linterna', 'luz', 'reflector'],
  clavadora: ['clavadora', 'engrapadora', 'grapadora'],
};

export function normalizarConsulta(q) {
  let s = norm(q).replace(/½/g, '1/2').replace(/¼/g, '1/4').replace(/¾/g, '3/4').replace(/[¿?¡!,;:()"]+/g, ' ').replace(/(\d+(?:\.\d)?)\s*ah\b/g, (m, d) => (/\./.test(d) ? d : d + '.0') + ' ah');
  const ws = s.split(/\s+/).filter(Boolean);
  const keep = ws.filter((w) => !STOP.has(w));
  return (keep.length ? keep : ws);
}

function textoModelo(m) {
  if (!m._q) {
    const extra = [];
    const b = norm(m.brand);
    if (MARCAS[b]) extra.push(...MARCAS[b]);
    const c = norm(m.cat);
    for (const [k, l] of Object.entries(SIN)) if (c.includes(k) || l.some((x) => c.includes(x))) extra.push(k, ...l);
    m._q = norm([m.name, m.model, m.brand, m.cat, m.fam, ...m.vars.map((v) => v.sku), ...extra].join(' '));
    m._ids = new Set([norm(m.model), ...m.vars.map((v) => norm(v.sku))]);
  }
  return m._q;
}

export function buscar(cat, consulta, { limite = 6, marca = '', soloConExistencia = false } = {}) {
  const terms = normalizarConsulta(consulta);
  if (!terms.length) return [];
  const mb = norm(marca);
  const res = [];
  for (const m of cat.M.values()) {
    if (m.oculto) continue;
    if (mb && !norm(m.brand).includes(mb)) continue;
    if (soloConExistencia && !(m.total > 0 || m.vars.some((v) => v.total > 0))) continue;
    const txt = textoModelo(m);
    let score = 0, hits = 0;
    for (const t of terms) {
      if (m._ids.has(t) || [...m._ids].some((id) => id.startsWith(t) && t.length >= 4 && /\d/.test(t))) { score += 100; hits++; continue; }
      const re = /^\d{1,2}$/.test(t) ? new RegExp('(^|[^0-9a-z.,])' + t) : null;
      if (re ? re.test(txt) : txt.includes(t)) { score += 10; hits++; }
      else if (t.length > 4 && txt.includes(t.slice(0, -1))) { score += 6; hits++; } // plural/singular
    }
    if (!hits || hits < Math.ceil(terms.length / 2)) continue;
    if (hits === terms.length) score += 20;
    if (m.total > 0) score += 5;
    res.push({ m, score });
  }
  res.sort((a, b) => b.score - a.score || (b.m.total > 0) - (a.m.total > 0) || String(a.m.model).localeCompare(String(b.m.model)));
  return res.slice(0, limite).map((r) => r.m);
}

export function modeloPorClave(cat, clave) {
  const c = String(clave || '').trim();
  const v = cat.bySku.get(c) || [...cat.bySku.values()].find((x) => norm(x.sku) === norm(c));
  const m = cat.M.get(c) || (v ? cat.M.get(v.model) : null) || [...cat.M.values()].find((x) => norm(x.model) === norm(c));
  if (!m || m.oculto) return null;
  return m;
}

// Lo que el asistente puede saber de un modelo
export function fichaModelo(cat, m, { maxVariantes = 8 } = {}) {
  const vars = m.vars.slice().sort((a, b) => (a.kit - b.kit) || (b.total > 0) - (a.total > 0) || GO[a.grade] - GO[b.grade]).slice(0, maxVariantes);
  const conExistencia = m.vars.filter((v) => v.total > 0 && precioPublico(v) > 0);
  const desde = conExistencia.length ? Math.min(...conExistencia.map(precioPublico)) : null;
  return {
    modelo: m.model,
    nombre: m.name,
    marca: m.brand,
    categoria: m.cat,
    enlace: urlProducto(cat.sitio || 'https://denmorherramientas.com', m.model),
    precio_desde_con_existencia: cat.preciosConfiables ? desde : null,
    variantes: vars.map((v) => {
      const f = fichaVariante(v);
      if (!cat.preciosConfiables) { f.precio = null; delete f.precio_antes; delete f.ahorro; }
      return f;
    }),
  };
}

export async function descripcion(cat, m, { fetchImpl = fetch } = {}) {
  const v = m.vars.find((x) => !x.kit && x.b >= 0) || m.vars[0];
  if (!v || v.b == null || v.b < 0 || !cat.detalleUrl) return '';
  try {
    const j = await traerJson(cat.detalleUrl.replace('{b}', v.b), fetchImpl);
    const d = j[v.sku] || Object.entries(j).find(([k]) => k.startsWith(m.model + '-'))?.[1];
    return d && d.c ? String(d.c).slice(0, 2500) : '';
  } catch {
    return '';
  }
}
