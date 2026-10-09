// SUPERVISOR WEB: revisa que el catálogo público funcione (sin IA, sin costo).
import { cargarCatalogo, buscar } from '../catalogo/index.js';
import { enc } from '../catalogo/modelo.js';

async function medir(nombre, fn) {
  const t = Date.now();
  try {
    const detalle = await fn();
    return { nombre, ok: true, detalle: detalle || 'Correcto', ms: Date.now() - t };
  } catch (e) {
    return { nombre, ok: false, detalle: String(e.message || e).slice(0, 300), ms: Date.now() - t };
  }
}

async function traer(fetchImpl, url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetchImpl(url, { signal: ctl.signal, headers: { 'user-agent': 'Denmor-Supervisor' }, redirect: 'follow' });
    return r;
  } finally {
    clearTimeout(t);
  }
}

export async function revisarSitio(cfg, { fetchImpl = fetch, ahora = new Date() } = {}) {
  const sitio = cfg.catalogo.sitio.replace(/\/$/, '');
  const checks = [];
  for (const url of cfg.supervisor.paginas) {
    checks.push(await medir(`Página ${url.replace(sitio, '') || '/'}`, async () => {
      const r = await traer(fetchImpl, url);
      if (r.status !== 200) throw new Error(`Respondió ${r.status}`);
      const html = await r.text();
      if (!/<title>/i.test(html)) throw new Error('La página no tiene título');
      if (url === sitio + '/' && !/wa\.me\/526141927887/.test(html)) throw new Error('No se encontró el botón de WhatsApp (wa.me/526141927887)');
      return `200 · ${Math.round(html.length / 1024)} KB`;
    }));
  }
  let cat = null;
  checks.push(await medir('Catálogo (core.json)', async () => {
    cat = await cargarCatalogo(cfg.catalogo, { fetchImpl, forzar: true, ahora });
    const visibles = [...cat.M.values()].filter((m) => !m.oculto);
    if (visibles.length < 10) throw new Error(`Solo ${visibles.length} modelos visibles`);
    if (!cat.preciosConfiables) throw new Error('No se pudieron leer los ajustes de precio (ajustes.json)');
    return `${visibles.length} modelos visibles · ${visibles.filter((m) => m.total > 0).length} con existencia`;
  }));
  checks.push(await medir('Existencias del robot de SICAR', async () => {
    if (!cat) throw new Error('Sin catálogo');
    if (!cat.existencias.aplicadas) throw new Error(cat.existencias.motivo);
    const horas = (ahora - new Date(cat.existencias.actualizado + (/[zZ]|[+-]\d\d:?\d\d$/.test(cat.existencias.actualizado) ? '' : '-06:00'))) / 3600e3;
    if (!(horas < cfg.supervisor.max_horas_existencias)) throw new Error(`Última actualización hace ${Math.round(horas * 10) / 10} h`);
    return `Actualizadas hace ${Math.max(0, Math.round(horas * 60))} min`;
  }));
  checks.push(await medir('Buscador (términos comunes)', async () => {
    if (!cat) throw new Error('Sin catálogo');
    const faltan = ['taladro', 'rotomartillo', 'bateria', 'impacto', 'milwaukee', 'dewalt'].filter((t) => !buscar(cat, t, { limite: 1 }).length);
    if (faltan.length) throw new Error('Sin resultados para: ' + faltan.join(', '));
    return 'Todos los términos con resultados';
  }));
  checks.push(await medir('Enlaces de productos (/p/…)', async () => {
    if (!cat) throw new Error('Sin catálogo');
    const con = [...cat.M.values()].filter((m) => !m.oculto && m.total > 0);
    const muestra = con.sort(() => Math.random() - 0.5).slice(0, 3);
    const malos = [];
    for (const m of muestra) {
      const r = await traer(fetchImpl, `${sitio}/p/${enc(m.model)}/`);
      const html = r.status === 200 ? await r.text() : '';
      if (r.status !== 200 || !html.includes(String(m.model))) malos.push(`${m.model} (${r.status})`);
    }
    if (malos.length) throw new Error('Enlaces con problema: ' + malos.join(', '));
    return `${muestra.length} enlaces revisados: ${muestra.map((m) => m.model).join(', ')}`;
  }));
  checks.push(await medir('Funciones del catálogo (/api/estado)', async () => {
    const r = await traer(fetchImpl, `${sitio}/api/estado`);
    if (r.status !== 200) throw new Error(`Respondió ${r.status}`);
    const j = await r.json();
    if (!j.ok) throw new Error('Respuesta sin ok');
    if (j.almacen === false) throw new Error('El almacén de pedidos (Netlify Blobs) no responde');
    return `versión ${j.version || '?'}`;
  }));
  const fallas = checks.filter((c) => !c.ok);
  return {
    ok: !fallas.length,
    checks,
    resumen: fallas.length ? `${fallas.length} de ${checks.length} revisiones con problema: ${fallas.map((f) => f.nombre).join(', ')}` : `Todo en orden (${checks.length} revisiones)`,
  };
}
