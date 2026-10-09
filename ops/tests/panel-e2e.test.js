// Prueba de punta a punta del panel en Chromium, con el servidor local (mismas funciones que en Netlify).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { iniciarServidorLocal } from '../scripts/servidor-local.mjs';
import * as repo from '../lib/repo.js';
import { cerrarDb } from '../lib/db.js';

let srv, nav, page;
const errores = [];

before(async () => {
  srv = await iniciarServidorLocal({ puerto: 8891, conservar: false });
  nav = await chromium.launch();
  page = await nav.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (d.message().includes('CONECTAR') ? 'CONECTAR' : 'Hola, ¿tienen el rotomartillo 2904?') : undefined));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
});
after(async () => { await nav?.close(); await srv?.cerrar(); await cerrarDb(); });

test('inicio de sesión local y tablero', { timeout: 30000 }, async () => {
  await page.goto(srv.base + '/');
  await page.click('#lLocal');
  await page.waitForSelector('#kpis .kpi');
  assert.equal(await page.locator('#kpis .kpi').count(), 9);
  assert.equal(await page.locator('#tabAgentes .row').count(), 7);
});

test('simulador: el vendedor responde con el precio del catálogo', { timeout: 30000 }, async () => {
  await page.click('a[href="#whatsapp"]');
  await page.click('#wSim');
  await page.waitForSelector('.m.out', { timeout: 15000 });
  const txt = await page.locator('.m.out').first().innerText();
  assert.match(txt, /Rotomartillo M18 FUEL/);
  assert.match(txt, /\$3,400/);
  assert.match(await page.locator('.aviso.sim').innerText(), /simulador/);
});

test('tomar conversación y reactivar asistente', { timeout: 30000 }, async () => {
  await page.click('#wTomar');
  await page.waitForSelector('.aviso.hum');
  await page.waitForSelector('#wReactivar');
  await page.click('#wReactivar');
  await page.waitForSelector('#wTomar');
  assert.equal(await page.locator('.aviso.hum').count(), 0);
});

test('orden en lenguaje natural → tareas → aprobación', { timeout: 40000 }, async () => {
  await page.click('a[href="#ordenes"]');
  await page.fill('#oTexto', 'Revisa el sitio y prepárame una publicación de baterías');
  await page.click('#oEnviar');
  await page.waitForFunction(() => document.querySelector('#oLista')?.innerText.includes('Asignada'), null, { timeout: 15000 }).catch(async () => { await page.click('a[href="#tablero"]'); await page.click('a[href="#ordenes"]'); await page.waitForFunction(() => document.querySelector('#oLista')?.innerText.includes('Asignada'), null, { timeout: 10000 }); });
  assert.match(await page.locator('#oLista').innerText(), /requiere tu aprobación/);
  // la revisión del sitio corre sola; la de marketing espera aprobación
  const tareas = await repo.listarTareas();
  assert.ok(tareas.some((t) => t.agente === 'marketing' && t.estado === 'esperando_aprobacion'));
  await page.click('a[href="#aprobaciones"]');
  await page.waitForSelector('[data-decidir="aprobada"]');
  await page.click('[data-decidir="aprobada"]');
  await page.waitForFunction(() => document.querySelector('#apHist')?.innerText.includes('Aprobada'));
  await new Promise((r) => setTimeout(r, 1500));
  const t2 = await repo.listarTareas();
  assert.ok(t2.some((t) => t.agente === 'marketing' && ['pendiente', 'en_proceso', 'completada'].includes(t.estado)));
});

test('pausar y reanudar todos los agentes', { timeout: 20000 }, async () => {
  await page.click('a[href="#tablero"]');
  await page.click('#btnPausa');
  await page.waitForSelector('#bandaPausa:not([hidden])');
  assert.equal((await repo.config({ fresca: true })).agentes.pausa_global, true);
  await page.click('#btnPausa');
  await page.waitForSelector('#bandaPausa[hidden]', { state: 'attached' });
  assert.equal((await repo.config({ fresca: true })).agentes.pausa_global, false);
});

test('configuración: guardar tiempos y ver estado de conexiones', { timeout: 20000 }, async () => {
  await page.click('a[href="#config"]');
  await page.waitForSelector('#cfT_saludo_a');
  await page.fill('#cfT_saludo_a', '3');
  await page.fill('#cfT_saludo_b', '9');
  await page.click('#cfTiemposG');
  await page.waitForFunction(() => document.querySelector('#toast')?.innerText === 'Guardado');
  assert.deepEqual((await repo.config({ fresca: true })).tiempos.saludo, [3, 9]);
  await page.waitForFunction(() => document.querySelector('#cfEstado')?.innerText.includes('Webhook'));
  assert.match(await page.locator('#cfEstado').innerText(), /Deshabilitado/);
});

test('webhook: rechaza sin secreto y acepta mensajes con secreto', async () => {
  const msg = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { contacts: [{ profile: { name: 'Prueba' }, wa_id: '5216149990000' }], messages: [{ from: '5216149990000', id: 'wamid.e2e', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'tienen baterias m18?' } }] } }] }] };
  const sin = await fetch(srv.base + '/webhook/whatsapp', { method: 'POST', body: JSON.stringify(msg), headers: { 'content-type': 'application/json' } });
  assert.equal(sin.status, 401);
  const con = await fetch(srv.base + '/webhook/whatsapp', { method: 'POST', body: JSON.stringify(msg), headers: { 'content-type': 'application/json', 'x-denmor-secreto': process.env.WEBHOOK_SECRETO } });
  assert.equal(con.status, 200);
  const c = await repo.conversacionPorWaId('5216149990000');
  assert.ok(c);
  const dup = await fetch(srv.base + '/webhook/whatsapp', { method: 'POST', body: JSON.stringify(msg), headers: { 'content-type': 'application/json', 'x-denmor-secreto': process.env.WEBHOOK_SECRETO } });
  assert.equal(dup.status, 200);
  const [{ n }] = await (await import('../lib/db.js')).db()`select count(*)::int as n from ops.mensajes where wa_message_id = 'wamid.e2e'`;
  assert.equal(n, 1);
});

test('vista en celular sin desbordes horizontales y sin errores de JavaScript', { timeout: 20000 }, async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const s of ['tablero', 'whatsapp', 'ordenes', 'agentes', 'aprobaciones', 'config']) {
    await page.click(`a[href="#${s}"]`);
    await page.waitForTimeout(400);
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(ancho <= 392, `la sección ${s} se desborda (${ancho}px)`);
  }
  assert.deepEqual(errores, []);
});
