import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { basePruebas, vaciar } from './ayuda/pg.js';
import * as repo from '../lib/repo.js';
import { cerrarDb } from '../lib/db.js';

let sql;
before(async () => { sql = await basePruebas(); });
beforeEach(async () => { await vaciar(sql); });
after(async () => { await cerrarDb(); });

test('RLS: los roles públicos de Supabase no pueden leer ni escribir', async () => {
  await repo.registrarEntrante({ waId: '5216140000001', nombre: 'Ana', waMessageId: 'wamid.1', texto: 'hola' });
  const tablas = await sql`select tablename, rowsecurity from pg_tables where schemaname = 'ops'`;
  assert.ok(tablas.length >= 12);
  for (const t of tablas) assert.equal(t.rowsecurity, true, `RLS apagado en ${t.tablename}`);
  for (const rol of ['anon', 'authenticated']) {
    await assert.rejects(sql.begin(async (tx) => { await tx.unsafe(`set local role ${rol}`); await tx.unsafe('select * from ops.mensajes'); }), /permission denied/);
    await assert.rejects(sql.begin(async (tx) => { await tx.unsafe(`set local role ${rol}`); await tx.unsafe(`insert into ops.operadores (email) values ('x@y.z')`); }), /permission denied/);
  }
});

test('mensajes duplicados de WhatsApp se ignoran', async () => {
  const a = await repo.registrarEntrante({ waId: '5216140000001', nombre: 'Ana', waMessageId: 'wamid.A', texto: 'hola' });
  const b = await repo.registrarEntrante({ waId: '5216140000001', nombre: 'Ana', waMessageId: 'wamid.A', texto: 'hola' });
  assert.equal(a.duplicado, false);
  assert.equal(b.duplicado, true);
  assert.equal(a.conversacionId, b.conversacionId);
  const [{ n }] = await sql`select count(*)::int as n from ops.mensajes`;
  assert.equal(n, 1);
});

test('respuesta desde la app detiene al asistente solo en esa conversación', async () => {
  const a = await repo.registrarEntrante({ waId: '5216140000001', waMessageId: 'wamid.1', texto: 'precio?' });
  const b = await repo.registrarEntrante({ waId: '5216140000002', waMessageId: 'wamid.2', texto: 'hola' });
  await repo.registrarEcoHumano({ waIdCliente: '5216140000001', waMessageId: 'wamid.eco1', texto: 'Yo te atiendo' });
  assert.equal((await repo.conversacion(a.conversacionId)).modo, 'humano');
  assert.equal((await repo.conversacion(b.conversacionId)).modo, 'asistente');
  assert.equal((await repo.sinResponder(a.conversacionId)).length, 0, 'lo anterior al humano ya no se responde');
  const dup = await repo.registrarEcoHumano({ waIdCliente: '5216140000001', waMessageId: 'wamid.eco1', texto: 'Yo te atiendo' });
  assert.equal(dup.duplicado, true);
  await repo.cambiarModo(a.conversacionId, 'asistente', 'prueba', 'propietario@denmor');
  assert.equal((await repo.conversacion(a.conversacionId)).modo, 'asistente');
});

test('el eco de la app no detiene al asistente si así se configuró', async () => {
  const a = await repo.registrarEntrante({ waId: '5216140000003', waMessageId: 'wamid.3', texto: 'hola' });
  await repo.registrarEcoHumano({ waIdCliente: '5216140000003', waMessageId: 'wamid.eco3', texto: 'ok', detener: false });
  assert.equal((await repo.conversacion(a.conversacionId)).modo, 'asistente');
});

test('candado: solo un proceso contesta a la vez', async () => {
  const a = await repo.registrarEntrante({ waId: '5216140000001', waMessageId: 'wamid.1', texto: 'hola' });
  assert.equal(await repo.tomarCandado(a.conversacionId), true);
  assert.equal(await repo.tomarCandado(a.conversacionId), false);
  await repo.soltarCandado(a.conversacionId);
  assert.equal(await repo.tomarCandado(a.conversacionId), true);
});

test('sinResponder y marcarRespondido', async () => {
  const a = await repo.registrarEntrante({ waId: '5216140000001', waMessageId: 'wamid.1', texto: 'uno', fecha: new Date(Date.now() - 2000) });
  await repo.registrarEntrante({ waId: '5216140000001', waMessageId: 'wamid.2', texto: 'dos', fecha: new Date(Date.now() - 1000) });
  const p = await repo.sinResponder(a.conversacionId);
  assert.deepEqual(p.map((m) => m.texto), ['uno', 'dos']);
  await repo.marcarRespondido(a.conversacionId, p[1].creado);
  assert.equal((await repo.sinResponder(a.conversacionId)).length, 0);
});

test('conteo diario de respuestas por contacto', async () => {
  const a = await repo.registrarEntrante({ waId: '5216140000001', waMessageId: 'wamid.1', texto: 'hola' });
  assert.equal(await repo.contarRespuesta(a.conversacionId), 1);
  assert.equal(await repo.contarRespuesta(a.conversacionId), 2);
  await sql`update ops.conversaciones set respuestas_dia = respuestas_dia - 1`;
  assert.equal(await repo.respuestasHoy(a.conversacionId), 0);
  assert.equal(await repo.contarRespuesta(a.conversacionId), 1);
});

test('configuración: se combinan valores guardados con los de fábrica', async () => {
  await repo.guardarConfig('tiempos', { saludo: [1, 2] }, 'propietario');
  const c = await repo.config({ fresca: true });
  assert.deepEqual(c.tiempos.saludo, [1, 2]);
  assert.deepEqual(c.tiempos.cotizacion, [15, 45]);
  await assert.rejects(repo.guardarConfig('inventada', {}, 'x'));
  // guardar otra opción de la misma sección no borra la anterior
  await repo.guardarConfig('tiempos', { agrupar: 7 }, 'propietario');
  const c2 = await repo.config({ fresca: true });
  assert.deepEqual([c2.tiempos.saludo, c2.tiempos.agrupar], [[1, 2], 7]);
});

test('tareas: prioridad, toma segura y recuperación', async () => {
  await repo.crearTarea({ agente: 'inventarios', titulo: 'normal', prioridad: 'normal' });
  await repo.crearTarea({ agente: 'inventarios', titulo: 'urgente', prioridad: 'urgente' });
  const [t1, t2, t3] = await Promise.all([repo.tomarTarea(['inventarios']), repo.tomarTarea(['inventarios']), repo.tomarTarea(['inventarios'])]);
  const tomadas = [t1, t2, t3].filter(Boolean).map((t) => t.titulo).sort();
  assert.deepEqual(tomadas, ['normal', 'urgente']);
  await sql`update ops.tareas set iniciada = now() - interval '1 hour'`;
  await repo.recuperarTareasAtoradas();
  const pend = await repo.listarTareas({ estado: 'pendiente' });
  assert.equal(pend.length, 2);
});

test('aprobaciones: solo se decide una vez y queda en bitácora', async () => {
  const a = await repo.solicitarAprobacion({ tipo: 'descuento', titulo: '10% en M18', solicitadoPor: 'vendedor', detalle: { pct: 10 } });
  const d = await repo.decidirAprobacion(a.id, 'aprobada', 'propietario@denmor', 'ok');
  assert.equal(d.estado, 'aprobada');
  assert.equal(await repo.decidirAprobacion(a.id, 'rechazada', 'otro'), null);
  const bit = await repo.listarBitacora();
  assert.ok(bit.some((b) => b.accion === 'aprobacion.aprobada'));
});

test('la bitácora y los errores no guardan claves', async () => {
  await repo.registrar('x', 'prueba', null, null, { api_key: 'sk-ant-abcdefghijklmnop', nota: 'token github_pat_ABCDEFGHIJKLMNOPQRST' });
  await repo.registrarError('prueba', new Error('falló con sk-ant-api03-ZZZZZZZZZZZZZZZZ'));
  const [b] = await repo.listarBitacora(1);
  assert.doesNotMatch(JSON.stringify(b.detalle), /abcdefghijklmnop|ABCDEFGHIJKLMNOPQRST/);
  const [e] = await repo.listarErrores(1);
  assert.doesNotMatch(e.mensaje, /ZZZZZZZZZZZZZZZZ/);
});

test('cotizaciones y resumen del día', async () => {
  const a = await repo.registrarEntrante({ waId: '5216140000001', waMessageId: 'wamid.1', texto: 'cotiza' });
  const c = await repo.crearCotizacion({ conversacionId: a.conversacionId, partidas: [{ sku: 'X', cantidad: 1, precio: 100 }], total: 100, creadoPor: 'vendedor' });
  assert.match(c.folio, /^DNC-\d{6}-[A-Z0-9]{4}$/);
  await repo.registrarUso({ agente: 'vendedor', modelo: 'claude-opus-5-5', uso: { input_tokens: 1000, output_tokens: 100 } });
  const r = await repo.resumenDia();
  assert.equal(r.conversaciones, 1);
  assert.equal(r.cotizaciones, 1);
  assert.equal(r.monto_cotizado, 100);
  assert.ok(Math.abs(r.costo_ia_usd - 0.006) < 1e-9);
  assert.ok(Math.abs((await repo.gastoHoy()) - 0.006) < 1e-9);
});

test('las conversaciones del simulador no cuentan en las métricas', async () => {
  await repo.registrarEntrante({ waId: 'sim-abc', waMessageId: 'sim.1', texto: 'hola' });
  await repo.registrarEntrante({ waId: '5216140000009', waMessageId: 'wamid.9', texto: 'hola' });
  const r = await repo.resumenDia();
  assert.equal(r.conversaciones, 1);
  assert.equal(r.mensajes_recibidos, 1);
});
