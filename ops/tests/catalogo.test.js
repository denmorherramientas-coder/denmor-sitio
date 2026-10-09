import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cargarCatalogo, olvidarCatalogo, buscar, modeloPorClave, fichaModelo, descripcion } from '../lib/catalogo/index.js';
import { DEFAULTS } from '../lib/config.js';
import * as F from './fixtures/catalogo.js';

const CFG = { ...DEFAULTS.catalogo, cache_minutos: 0 };

function fetchFalso({ sinAjustes = false, sinExistencias = false, sinCore = false } = {}) {
  return async (url) => {
    const u = url.split('?')[0];
    const ok = (o) => ({ ok: true, status: 200, json: async () => o });
    const no = { ok: false, status: 503, json: async () => ({}) };
    if (u === CFG.core) return sinCore ? no : ok(F.core());
    if (u === CFG.ajustes) return sinAjustes ? no : ok(F.ajustes({ promo: false }));
    if (u === CFG.existencias) return sinExistencias ? no : ok(F.existencias());
    if (u.endsWith('/detail-0.json')) return ok({ '2904-20-AA': { c: 'Rotomartillo con motor sin carbones POWERSTATE.' } });
    return no;
  };
}

beforeEach(() => olvidarCatalogo());

test('búsqueda por clave, modelo, marca y palabras coloquiales', async () => {
  const cat = await cargarCatalogo(CFG, { fetchImpl: fetchFalso() });
  assert.equal(buscar(cat, '2904-20')[0].model, '2904-20');
  assert.equal(buscar(cat, 'tienes el 2904?')[0].model, '2904-20');
  assert.equal(buscar(cat, 'DCD791B-AA')[0].model, 'DCD791B');
  const roto = buscar(cat, 'rotomartillo milwaukee').map((m) => m.model);
  assert.equal(roto[0], '2904-20');
  assert.ok(buscar(cat, 'pistola de impacto ryobi').some((m) => m.model === 'P262'));
  assert.ok(buscar(cat, 'bateria 5ah m18').some((m) => m.model === '48-11-1850'));
  assert.deepEqual(buscar(cat, 'xyzzy inexistente'), []);
});

test('productos ocultos en el panel no se ofrecen', async () => {
  const cat = await cargarCatalogo(CFG, { fetchImpl: fetchFalso() });
  assert.equal(buscar(cat, 'producto oculto').length, 0);
  assert.equal(modeloPorClave(cat, 'OCULTO-AA'), null);
});

test('ficha: precio público, existencia por sucursal y enlace', async () => {
  const cat = await cargarCatalogo(CFG, { fetchImpl: fetchFalso() });
  const f = fichaModelo(cat, modeloPorClave(cat, '2904-20'));
  assert.equal(f.enlace, 'https://denmorherramientas.com/p/2904-20/');
  const aa = f.variantes.find((v) => v.clave === '2904-20-AA');
  assert.equal(aa.precio, 3400); // 3170 × 1.02 × 1.05 = 3395.07 → redondeado a 10
  assert.equal(aa.precio_antes, 3530);
  assert.deepEqual(aa.existencia, { denmor_jose_marti: 1, bodega_chihuahua: 2, cdmx: 0, total: 3 });
  assert.match(aa.condicion, /Nuevo en caja/);
  const sinPrecio = fichaModelo(cat, modeloPorClave(cat, 'SINPRECIO'));
  assert.equal(sinPrecio.variantes[0].precio, null, 'precio 0 nunca se informa como precio');
  assert.equal(f.variantes.some((v) => 'p2' in v || 'p3' in v), false, 'nunca precios de distribuidor');
});

test('sin ajustes de precio el asistente no da precios', async () => {
  const cat = await cargarCatalogo(CFG, { fetchImpl: fetchFalso({ sinAjustes: true }) });
  assert.equal(cat.preciosConfiables, false);
  const f = fichaModelo(cat, modeloPorClave(cat, '2904-20'));
  assert.ok(f.variantes.every((v) => v.precio === null));
  assert.equal(f.precio_desde_con_existencia, null);
});

test('si fallan los ajustes después de una lectura buena, se usa la última copia', async () => {
  await cargarCatalogo(CFG, { fetchImpl: fetchFalso() });
  const cat = await cargarCatalogo(CFG, { fetchImpl: fetchFalso({ sinAjustes: true }), forzar: true });
  assert.equal(cat.preciosConfiables, true);
});

test('sin existencias en vivo se avisa', async () => {
  const cat = await cargarCatalogo(CFG, { fetchImpl: fetchFalso({ sinExistencias: true }) });
  assert.equal(cat.existencias.aplicadas, false);
  assert.ok(cat.avisos.some((a) => /Existencias sin actualizar/.test(a)));
});

test('sin core.json no hay catálogo', async () => {
  await assert.rejects(cargarCatalogo(CFG, { fetchImpl: fetchFalso({ sinCore: true }) }), /No se pudo leer el catálogo/);
});

test('descripción del producto', async () => {
  const cat = await cargarCatalogo(CFG, { fetchImpl: fetchFalso() });
  assert.match(await descripcion(cat, modeloPorClave(cat, '2904-20'), { fetchImpl: fetchFalso() }), /POWERSTATE/);
});
