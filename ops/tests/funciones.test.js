// Cada función de Netlify se carga como en producción y expone lo que Netlify espera.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { cerrarDb } from '../lib/db.js';

const DIR = new URL('../netlify/functions/', import.meta.url);
const archivos = readdirSync(DIR).filter((f) => f.endsWith('.mjs'));
after(async () => { await cerrarDb(); });

test('todas las funciones cargan y exportan un manejador', async () => {
  assert.deepEqual(archivos.sort(), ['api.mjs', 'atender-background.mjs', 'cron-cada-hora.mjs', 'cron-manana.mjs', 'cron-noche.mjs', 'cron-semanal.mjs', 'tareas-background.mjs', 'whatsapp-webhook.mjs']);
  for (const f of archivos) {
    const m = await import(new URL(f, DIR));
    assert.equal(typeof m.default, 'function', f);
    assert.equal(typeof m.config, 'object', f);
  }
});

test('horarios en UTC equivalentes a la hora de Chihuahua (UTC-6)', async () => {
  const h = {};
  for (const f of archivos.filter((x) => x.startsWith('cron-'))) h[f] = (await import(new URL(f, DIR))).config.schedule;
  assert.deepEqual(h, { 'cron-cada-hora.mjs': '7 * * * *', 'cron-manana.mjs': '3 14 * * *', 'cron-noche.mjs': '55 1 * * *', 'cron-semanal.mjs': '0 15 * * 1' });
  for (const s of Object.values(h)) assert.match(s, /^[\d*/,-]+( [\d*/,-]+){4}$/);
});

test('rutas y funciones en segundo plano', async () => {
  assert.equal((await import(new URL('api.mjs', DIR))).config.path, '/api/*');
  assert.equal((await import(new URL('whatsapp-webhook.mjs', DIR))).config.path, '/webhook/whatsapp');
  for (const f of ['atender-background.mjs', 'tareas-background.mjs']) assert.equal((await import(new URL(f, DIR))).config.background, true);
});

test('las funciones internas rechazan llamadas sin el secreto interno', async () => {
  process.env.INTERNO_SECRETO = 'x'.repeat(40);
  for (const f of ['atender-background.mjs', 'tareas-background.mjs']) {
    const h = (await import(new URL(f, DIR))).default;
    const sin = await h(new Request('https://ops.local/.netlify/functions/' + f, { method: 'POST', body: '{}' }));
    assert.equal(sin.status, 401, f);
    const mal = await h(new Request('https://ops.local/.netlify/functions/' + f, { method: 'POST', body: '{}', headers: { 'x-interno': 'y'.repeat(40) } }));
    assert.equal(mal.status, 401, f);
  }
});

test('webhook sin secreto configurado no acepta nada', async () => {
  delete process.env.WEBHOOK_SECRETO;
  const h = (await import(new URL('whatsapp-webhook.mjs', DIR))).default;
  const r = await h(new Request('https://ops.local/webhook/whatsapp', { method: 'POST', body: '{}' }));
  assert.equal(r.status, 503);
  process.env.WEBHOOK_SECRETO = 'corto';
  assert.equal((await h(new Request('https://ops.local/webhook/whatsapp', { method: 'POST', body: '{}', headers: { 'x-denmor-secreto': 'corto' } }))).status, 503, 'secretos cortos no se aceptan');
});
