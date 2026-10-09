import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { basePruebas, vaciar } from './ayuda/pg.js';
import * as repo from '../lib/repo.js';
import { cerrarDb } from '../lib/db.js';
import { manejar } from '../lib/api.js';

let sql;
const fetchOriginal = globalThis.fetch;
const TOKENS = { 'token-dueno-0123456789abcdef': 'dueno@denmor.com', 'token-empleado-0123456789abcd': 'empleado@denmor.com', 'token-extrano-0123456789abcde': 'extrano@gmail.com' };

before(async () => {
  sql = await basePruebas();
  process.env.SUPABASE_URL = 'https://proyecto.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'llave-publica-anon';
  globalThis.__denmorDisparar = async () => {};
  // Supabase Auth falso: /auth/v1/user responde según el token
  globalThis.fetch = async (url, opt = {}) => {
    if (String(url) === 'https://proyecto.supabase.co/auth/v1/user') {
      const t = String(opt.headers?.authorization || '').replace('Bearer ', '');
      if (opt.headers?.apikey !== 'llave-publica-anon' || !TOKENS[t]) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ email: TOKENS[t] }), { status: 200 });
    }
    return fetchOriginal(url, opt);
  };
});
beforeEach(async () => {
  await vaciar(sql);
  await sql`insert into ops.operadores (email, nombre, rol) values ('dueno@denmor.com', 'Dueño', 'propietario'), ('empleado@denmor.com', 'Empleado', 'operador')`;
});
after(async () => { globalThis.fetch = fetchOriginal; delete globalThis.__denmorDisparar; await cerrarDb(); });

const llamar = async (ruta, { token, metodo = 'GET', body } = {}) => {
  const r = await manejar(new Request('https://ops.denmorherramientas.com/api' + ruta, { method: metodo, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, j: await r.json() };
};
const DUENO = 'token-dueno-0123456789abcdef', EMPLEADO = 'token-empleado-0123456789abcd', EXTRANO = 'token-extrano-0123456789abcde';

test('sin sesión, con token inválido o con correo no autorizado: 401', async () => {
  assert.equal((await llamar('/tablero')).status, 401);
  assert.equal((await llamar('/tablero', { token: 'token-falso-0123456789abcdefgh' })).status, 401);
  assert.equal((await llamar('/tablero', { token: EXTRANO })).status, 401);
  const p = await llamar('/publico');
  assert.equal(p.status, 200);
  assert.deepEqual(Object.keys(p.j).sort(), ['supabaseAnonKey', 'supabaseUrl']);
});

test('operador desactivado pierde el acceso', async () => {
  await sql`update ops.operadores set activo = false where email = 'empleado@denmor.com'`;
  assert.equal((await llamar('/sesion', { token: 'token-empleado-0123456789abcd' + '' })).status, 401);
});

test('permisos: solo el propietario aprueba y cambia agentes o límites', async () => {
  const ap = await repo.solicitarAprobacion({ tipo: 'publicacion', titulo: 'x', solicitadoPor: 'marketing' });
  assert.equal((await llamar(`/aprobaciones/${ap.id}`, { token: EMPLEADO, metodo: 'POST', body: { decision: 'aprobada' } })).status, 403);
  assert.equal((await llamar('/agentes/vendedor', { token: EMPLEADO, metodo: 'POST', body: { activo: false } })).status, 403);
  assert.equal((await llamar('/config/limites', { token: EMPLEADO, metodo: 'PUT', body: { valor: { presupuesto_diario_usd: 99 } } })).status, 403);
  assert.equal((await llamar('/config/tiempos', { token: EMPLEADO, metodo: 'PUT', body: { valor: { saludo: [2, 4] } } })).status, 200, 'los tiempos sí los cambia un operador');
  const r = await llamar(`/aprobaciones/${ap.id}`, { token: DUENO, metodo: 'POST', body: { decision: 'aprobada', nota: 'ok' } });
  assert.equal(r.status, 200);
  assert.equal((await llamar('/agentes/vendedor', { token: DUENO, metodo: 'POST', body: { activo: false, modelo: 'claude-sonnet-5-5', esfuerzo: 'medium' } })).status, 200);
  const cfg = await repo.config({ fresca: true });
  assert.deepEqual([cfg.agentes.vendedor.activo, cfg.agentes.vendedor.modelo, cfg.agentes.vendedor.esfuerzo], [false, 'claude-sonnet-5-5', 'medium']);
  assert.equal((await llamar('/agentes/vendedor', { token: DUENO, metodo: 'POST', body: { modelo: 'gpt-x' } })).status, 200);
  assert.equal((await repo.config({ fresca: true })).agentes.vendedor.modelo, 'claude-sonnet-5-5', 'modelos desconocidos se ignoran');
});

test('cualquier operador puede pausar todo (botón de emergencia)', async () => {
  const r = await llamar('/agentes/pausa', { token: EMPLEADO, metodo: 'POST', body: { pausa: true } });
  assert.equal(r.j.pausa_global, true);
  assert.equal((await repo.config({ fresca: true })).agentes.pausa_global, true);
  assert.ok((await repo.listarBitacora()).some((b) => b.actor === 'empleado@denmor.com' && b.accion === 'config.guardar'));
});

test('validación de configuración', async () => {
  for (const [sec, valor] of [['tiempos', { saludo: [20, 5] }], ['tiempos', { consulta: [1, 999] }], ['horario', { dias: { lun: ['9', '19'] } }], ['limites', { presupuesto_diario_usd: -1 }], ['catalogo', { core: 'http://inseguro' }], ['inventada', {}]]) {
    const r = await llamar(`/config/${sec}`, { token: DUENO, metodo: 'PUT', body: { valor } });
    assert.equal(r.status, 400, `${sec} ${JSON.stringify(valor)}`);
  }
});

test('conversaciones: teléfonos enmascarados; tomar, reactivar y responder desde el panel', async () => {
  const e = await repo.registrarEntrante({ waId: '5216141112233', nombre: 'Luis', waMessageId: 'x1', texto: 'hola' });
  const l = await llamar('/conversaciones', { token: EMPLEADO });
  assert.equal(l.j.conversaciones[0].telefono, '521614•••2233');
  assert.equal(l.j.conversaciones[0].wa_id, undefined);
  assert.equal(JSON.stringify(l.j).includes('5216141112233'), false);
  await llamar(`/conversaciones/${e.conversacionId}/tomar`, { token: EMPLEADO, metodo: 'POST' });
  assert.equal((await repo.conversacion(e.conversacionId)).modo, 'humano');
  await llamar(`/conversaciones/${e.conversacionId}/reactivar`, { token: EMPLEADO, metodo: 'POST' });
  const c = await repo.conversacion(e.conversacionId);
  assert.equal(c.modo, 'asistente');
  assert.equal((await repo.sinResponder(e.conversacionId)).length, 0, 'al reactivar no se contesta lo viejo de golpe');
  const r = await llamar(`/conversaciones/${e.conversacionId}/mensaje`, { token: EMPLEADO, metodo: 'POST', body: { texto: 'Hola Luis, soy de Denmor' } });
  assert.equal(r.j.simulado, true, 'sin WHATSAPP_ENVIO_HABILITADO no sale nada');
  const h = await repo.historial(e.conversacionId);
  assert.equal(h[h.length - 1].autor, 'humano_panel');
  assert.equal((await repo.conversacion(e.conversacionId)).modo, 'humano');
});

test('conectar webhook exige confirmación escrita y ser propietario', async () => {
  assert.equal((await llamar('/whatsapp/conectar-webhook', { token: EMPLEADO, metodo: 'POST', body: { confirmo: 'CONECTAR' } })).status, 403);
  assert.equal((await llamar('/whatsapp/conectar-webhook', { token: DUENO, metodo: 'POST', body: {} })).status, 400);
  const r = await llamar('/whatsapp/conectar-webhook', { token: DUENO, metodo: 'POST', body: { confirmo: 'CONECTAR' } });
  assert.match(r.j.error, /Faltan D360_API_KEY o WEBHOOK_SECRETO/);
});

test('estado: nunca devuelve valores de variables, solo si existen', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-SECRETO-NO-DEBE-SALIR';
  try {
    const r = await llamar('/estado', { token: DUENO });
    assert.equal(r.j.variables.ANTHROPIC_API_KEY, true);
    assert.equal(JSON.stringify(r.j).includes('SECRETO-NO-DEBE-SALIR'), false);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});
