// INVENTARIOS: detecta problemas del catálogo (sin IA, sin costo).
import { norm, precioPublico, columnasSucursal } from '../catalogo/modelo.js';

export function revisarInventario(cat, existencias = null) {
  const visibles = [...cat.M.values()].filter((m) => !m.oculto);
  const vars = visibles.flatMap((m) => m.vars);
  const conExistencia = vars.filter((v) => v.total > 0);

  const sinFoto = conExistencia.filter((v) => !v.kit && !v.img && !(Array.isArray(v.pics) && v.pics.length)).map((v) => ({ clave: v.sku, nombre: v.name, existencia: v.total }));
  const sinPrecio = conExistencia.filter((v) => !(precioPublico(v) > 0)).map((v) => ({ clave: v.sku, nombre: v.name, existencia: v.total }));
  const ofertaRara = vars.filter((v) => v.p1 > 0 && v.disc > 0 && (v.disc > v.p1 || v.disc < v.p1 * 0.4)).map((v) => ({ clave: v.sku, precio: v.p1, oferta: v.disc }));
  const negativos = vars.filter((v) => v.st.some((x) => x < 0)).map((v) => ({ clave: v.sku, existencia: v.st }));

  // claves repetidas en el catálogo y nombres iguales en modelos distintos
  const vistas = new Map();
  for (const v of cat.P) vistas.set(v.sku, (vistas.get(v.sku) || 0) + 1);
  const clavesDuplicadas = [...vistas].filter(([, n]) => n > 1).map(([clave, n]) => ({ clave, veces: n }));
  const porNombre = new Map();
  for (const m of visibles) { const k = norm(m.name).replace(/\s+/g, ' ').trim(); if (!k) continue; if (!porNombre.has(k)) porNombre.set(k, []); porNombre.get(k).push(m.model); }
  const nombresDuplicados = [...porNombre].filter(([, ms]) => ms.length > 1).map(([nombre, modelos]) => ({ nombre, modelos }));

  // existencia en SICAR que no aparece en el catálogo (mercancía que no se está mostrando)
  let enSicarNoCatalogo = [];
  if (existencias?.existencias) {
    const ids = columnasSucursal(existencias.sucursales).map(([id]) => id); // solo Bodega 1, Denmor y CDMX
    const total = (e) => ids.reduce((s, id) => s + (+e[id] || 0), 0);
    enSicarNoCatalogo = Object.entries(existencias.existencias)
      .filter(([sku, e]) => !cat.bySku.has(sku) && total(e) > 0)
      .map(([sku, e]) => ({ clave: sku, existencia: total(e) }))
      .sort((a, b) => b.existencia - a.existencia);
  }

  const hallazgos = { sinFoto, sinPrecio, ofertaRara, negativos, clavesDuplicadas, nombresDuplicados, enSicarNoCatalogo };
  const conteo = Object.fromEntries(Object.entries(hallazgos).map(([k, v]) => [k, v.length]));
  const etiquetas = { sinFoto: 'sin fotografía', sinPrecio: 'con existencia y sin precio', ofertaRara: 'con oferta sospechosa', negativos: 'con existencia negativa', clavesDuplicadas: 'claves duplicadas', nombresDuplicados: 'nombres repetidos en modelos distintos', enSicarNoCatalogo: 'claves con existencia en SICAR que no están en el catálogo' };
  const lineas = Object.entries(conteo).filter(([, n]) => n > 0).map(([k, n]) => `• ${n} ${etiquetas[k]}`);
  return {
    modelos_visibles: visibles.length,
    variantes_con_existencia: conExistencia.length,
    conteo,
    hallazgos: Object.fromEntries(Object.entries(hallazgos).map(([k, v]) => [k, v.slice(0, 40)])),
    resumen: lineas.length ? `Se encontraron:\n${lineas.join('\n')}` : 'Sin problemas detectados.',
    avisos: cat.avisos || [],
  };
}
