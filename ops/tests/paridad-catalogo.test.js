// Paridad con la página real: se abre el index.html del catálogo en Chromium con datos de prueba y se compara,
// clave por clave, el precio público y la existencia que ve el cliente contra lo que calcula el asistente.
// Así el asistente nunca dice un precio distinto al de la página.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { construirCatalogo, precioPublico } from '../lib/catalogo/modelo.js';
import * as F from './fixtures/catalogo.js';

const INDEX = fileURLToPath(new URL('../../index.html', import.meta.url));
const EX_URL = 'https://raw.githubusercontent.com/makmexchihuahua-hub/makmex-existencias/main/existencias.json';

function indexConGancho() {
  let html = readFileSync(INDEX, 'utf8');
  const a = 'const bySku=new Map(P.map(p=>[p.sku,p]));';
  const b = "renderDetail();\n  promotePedido();\n}";
  assert.equal(html.split(a).length, 2, 'index.html cambió: no se encontró el punto de enganche de productos');
  assert.equal(html.split(b).length, 2, 'index.html cambió: no se encontró el final de applyStock');
  html = html.replace(a, a + ' window.__P=P;').replace(b, "renderDetail();\n  window.__exOk=1; promotePedido();\n}");
  return html;
}

async function preciosDeLaPagina({ promo }) {
  const navegador = await chromium.launch();
  try {
    const page = await navegador.newPage();
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));
    const html = indexConGancho();
    await page.route('**/*', (route) => {
      const u = new URL(route.request().url());
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.href.startsWith(EX_URL)) return json(F.existencias());
      if (u.hostname !== 'denmor.prueba') return route.fulfill({ status: 404, body: '' });
      if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      if (u.pathname === '/core.json') return json(F.core());
      if (u.pathname === '/ajustes.json') return json(F.ajustes({ promo }));
      if (u.pathname === '/existencias.json') return json(F.existencias());
      if (u.pathname.startsWith('/api/')) return json({ ok: true });
      if (u.pathname === '/jspdf.umd.min.js' || u.pathname === '/js/jspdf.umd.min.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('https://denmor.prueba/');
    await page.waitForFunction(() => window.__P && window.__exOk, null, { timeout: 15000 });
    const P = await page.evaluate(() => window.__P.map((p) => ({ sku: p.sku, model: p.model, p1: p.p1, disc: p.disc, st: p.st, total: p.total, kit: p.kit, combo: p.combo })));
    return { P, errores };
  } finally {
    await navegador.close();
  }
}

for (const promo of [true, false]) {
  test(`precios y existencias iguales a la página (${promo ? 'con' : 'sin'} promoción)`, { timeout: 60000 }, async () => {
    const { P: pagina, errores } = await preciosDeLaPagina({ promo });
    assert.deepEqual(errores, [], 'la página tuvo errores de JavaScript');
    const nuestro = construirCatalogo(F.core(), F.ajustes({ promo }), F.existencias());
    assert.ok(nuestro.existencias.aplicadas);
    assert.equal(!!nuestro.promo, promo);
    const porSku = new Map(nuestro.P.map((p) => [p.sku, p]));
    let comparados = 0;
    for (const w of pagina) {
      if (w.combo) continue;
      const n = porSku.get(w.sku);
      assert.ok(n, `falta ${w.sku}`);
      assert.equal(precioPublico(n), w.disc || w.p1, `precio público de ${w.sku}`);
      assert.equal(n.p1, w.p1, `precio de lista de ${w.sku}`);
      assert.deepEqual(n.st, w.st, `existencia por sucursal de ${w.sku}`);
      assert.equal(n.total, w.total, `existencia total de ${w.sku}`);
      comparados++;
    }
    assert.equal(comparados, F.core().rows.length);
  });
}
