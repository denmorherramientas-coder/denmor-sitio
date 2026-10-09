import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { basePruebas, vaciar } from './ayuda/pg.js';
import { claudeFalso, ultimoResultado } from './ayuda/claude-falso.js';
import * as repo from '../lib/repo.js';
import * as vendedor from '../lib/agentes/vendedor.js';
import { cerrarDb } from '../lib/db.js';
import { atender, dentroDeHorario, pideAsesor } from '../lib/flujo/atender.js';
import { cargarCatalogo, olvidarCatalogo } from '../lib/catalogo/index.js';
import { clienteWhatsApp, leerWebhook } from '../lib/whatsapp/d360.js';
import { DEFAULTS } from '../lib/config.js';
import * as F from './fixtures/catalogo.js';

let sql;
const CFG_CAT = { ...DEFAULTS.catalogo, cache_minutos: 0 };
const fetchCatalogo = async (url) => {
  const u = url.split('?')[0];
  const ok = (o) => ({ ok: true, status: 200, json: async () => o });
  if (u === CFG_CAT.core) return ok(F.core());
  if (u === CFG_CAT.ajustes) return ok(F.ajustes({ promo: false }));
  if (u === CFG_CAT.existencias) return ok(F.existencias());
  return { ok: false, status: 404, json: async () => ({}) };
};
const SIEMPRE_ABIERTO = { dias: Object.fromEntries(['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'].map((d) => [d, ['00:00', '24:00']])), fuera_de_horario: 'atender' };

function waFalso() {
  const enviados = [];
  return { enviados, async enviarTexto(to, texto) { enviados.push({ to, texto }); return { id: 'wamid.out' + enviados.length, simulado: false }; }, async escribiendo() { return true; } };
}

function deps({ guion, wa = waFalso(), dormir = async () => {} }) {
  const cliente = claudeFalso(guion);
  return { repo, wa, cliente, vendedor, dormir, aleatorio: () => 0, catalogo: () => cargarCatalogo(CFG_CAT, { fetchImpl: fetchCatalogo }), fetchImpl: fetchCatalogo };
}

async function entrante(texto, { waId = '5216141112233', id = 'wamid.in' + Math.random(), fecha = new Date() } = {}) {
  const r = await repo.registrarEntrante({ waId, nombre: 'Cliente Prueba', waMessageId: id, texto, fecha });
  return { conversacionId: r.conversacionId, recibido: r.creado };
}

before(async () => { sql = await basePruebas(); });
beforeEach(async () => {
  await vaciar(sql);
  olvidarCatalogo();
  await repo.guardarConfig('horario', SIEMPRE_ABIERTO, 'prueba');
  await repo.guardarConfig('tiempos', { agrupar: 0 }, 'prueba');
});
after(async () => { await cerrarDb(); });

test('consulta normal: busca en el catálogo y responde con el precio real', async () => {
  const d = deps({
    guion: [
      { herramienta: 'buscar_productos', entrada: { consulta: '2904', marca: '', solo_con_existencia: false } },
      (p) => { const r = ultimoResultado(p).resultados[0]; const v = r.variantes.find((x) => x.clave === '2904-20-AA'); return { texto: `Sí lo tenemos: *${r.nombre}* nuevo en caja a $${v.precio.toLocaleString('en-US')}. ${r.enlace}` }; },
    ],
  });
  const ev = await entrante('hola, tienen el rotomartillo 2904?');
  const r = await atender(ev, d);
  assert.equal(r.resultado, 'respondido');
  assert.equal(d.wa.enviados.length, 1);
  assert.match(d.wa.enviados[0].texto, /\$3,400/);
  assert.equal((await repo.sinResponder(ev.conversacionId)).length, 0);
  const hist = await repo.historial(ev.conversacionId);
  assert.deepEqual(hist.map((m) => m.autor), ['cliente', 'asistente']);
  // el sistema va en caché y las herramientas son estrictas
  const p0 = d.cliente.llamadas[0];
  assert.equal(p0.system[0].cache_control.type, 'ephemeral');
  assert.ok(p0.tools.every((t) => t.strict === true));
  assert.equal(p0.model, 'claude-opus-5-5');
  assert.equal(p0.output_config.effort, 'low');
  assert.deepEqual(p0.betas, ['server-side-fallback-2026-07-01']);
  const [{ n }] = await sql`select count(*)::int as n from ops.uso_ia where agente = 'vendedor'`;
  assert.equal(n, 2);
});

test('precio inventado: se bloquea, se reintenta y si insiste pasa a un asesor', async () => {
  const d = deps({ guion: [{ texto: 'Te lo dejo en $1,234' }, { texto: 'Mejor en $1,111' }] });
  const ev = await entrante('cuanto cuesta el taladro dewalt?');
  await atender(ev, d);
  assert.equal(d.wa.enviados.length, 1);
  assert.doesNotMatch(d.wa.enviados[0].texto, /1,234|1,111/);
  assert.match(d.wa.enviados[0].texto, /asesor/);
  const c = await repo.conversacion(ev.conversacionId);
  assert.equal(c.modo, 'humano');
  assert.match(c.motivo_modo, /Precio no verificado/);
  const bit = await repo.listarBitacora();
  assert.ok(bit.some((b) => b.accion === 'verificador.precio_bloqueado'));
});

test('precio corregido tras la verificación sí se envía', async () => {
  const d = deps({
    guion: [
      { texto: 'Cuesta $999' },
      { herramienta: 'ver_producto', entrada: { clave: 'DCD791B' } },
      (p) => ({ texto: `El DCD791B nuevo está en $${ultimoResultado(p).variantes[0].precio}` }),
    ],
  });
  const ev = await entrante('precio del DCD791B');
  await atender(ev, d);
  assert.match(d.wa.enviados[0].texto, /\$1680/); // precio fijo 1777 sobre lista 1899 → la oferta 1799 se ajusta igual: 1680
  assert.equal((await repo.conversacion(ev.conversacionId)).modo, 'asistente');
});

test('si el dueño responde desde la app mientras se prepara la respuesta, no se envía nada', async () => {
  let ev;
  let n = 0;
  const d = deps({
    guion: [{ texto: 'Claro, te ayudo.' }],
    dormir: async () => { if (++n === 2) await repo.registrarEcoHumano({ waIdCliente: '5216141112233', waMessageId: 'wamid.eco', texto: 'Yo te atiendo' }); },
  });
  ev = await entrante('hola');
  const r = await atender(ev, d);
  assert.equal(r.resultado, 'atiende_humano');
  assert.equal(d.wa.enviados.length, 0);
  assert.ok((await repo.listarBitacora()).some((b) => b.accion === 'respuesta.descartada'));
});

test('pausa general: nadie responde', async () => {
  await repo.guardarConfig('agentes', { pausa_global: true }, 'prueba');
  const d = deps({ guion: [{ texto: 'hola' }] });
  const r = await atender(await entrante('hola'), d);
  assert.equal(r.resultado, 'pausa_global');
  assert.equal(d.cliente.llamadas.length, 0);
});

test('conversación tomada: el asistente no contesta hasta reactivarla', async () => {
  const ev = await entrante('hola');
  await repo.cambiarModo(ev.conversacionId, 'humano', 'Tomada desde el panel', 'dueño');
  const d = deps({ guion: [{ texto: 'Hola, ¿en qué te ayudo?' }] });
  assert.equal((await atender(ev, d)).resultado, 'atiende_humano');
  await repo.cambiarModo(ev.conversacionId, 'asistente', 'Reactivado', 'dueño');
  assert.equal((await atender(ev, d)).resultado, 'respondido');
});

test('varios mensajes seguidos se contestan juntos una sola vez', async () => {
  const d = deps({ guion: [{ texto: 'Con gusto. ¿Qué voltaje buscas?' }] });
  const a = await entrante('hola', { fecha: new Date(Date.now() - 1000) });
  const b = await entrante('busco un taladro');
  assert.equal((await atender(a, d)).resultado, 'agrupado');
  assert.equal((await atender(b, d)).resultado, 'respondido');
  assert.equal(d.wa.enviados.length, 1);
  const msgs = d.cliente.llamadas[0].messages;
  assert.match(msgs[msgs.length - 1].content, /hola\nbusco un taladro/);
});

test('transferencia a humano pedida por el cliente', async () => {
  const d = deps({ guion: [{ herramienta: 'transferir_a_humano', entrada: { motivo: 'Quiere pagar con transferencia', urgente: true } }, { texto: 'Te comunico con un asesor, te responde por aquí.' }] });
  const ev = await entrante('ya quiero pagar, me pasas la cuenta?');
  await atender(ev, d);
  assert.equal(d.wa.enviados.length, 1);
  const c = await repo.conversacion(ev.conversacionId);
  assert.equal(c.modo, 'humano');
  assert.match(c.motivo_modo, /URGENTE/);
});

test('cotización: el total lo calcula el sistema y queda registrada', async () => {
  const d = deps({
    guion: [
      { herramienta: 'crear_cotizacion', entrada: { partidas: [{ clave: '2904-20-AA', cantidad: 2 }, { clave: 'P262-AA', cantidad: 1 }], entrega: 'tienda' } },
      (p) => { const r = ultimoResultado(p); return { texto: `Folio ${r.folio}: total $${r.total.toLocaleString('en-US')}. Precio y existencia se confirman al cerrar.` }; },
    ],
  });
  const ev = await entrante('cotizame 2 rotomartillos 2904 y una llave ryobi');
  await atender(ev, d);
  const [q] = await repo.listarCotizaciones();
  assert.equal(q.total, 3400 * 2 + 1520); // P262 (Ryobi): 1333 × 1.02 × 1.015 × 1.10 = 1518.1 → 1520
  assert.match(d.wa.enviados[0].texto, new RegExp(q.folio));
  const c = await repo.conversacion(ev.conversacionId);
  assert.equal(c.interesado, true);
});

test('cotización rechaza productos ocultos o sin precio', async () => {
  const cat = await cargarCatalogo(CFG_CAT, { fetchImpl: fetchCatalogo });
  const ev = await entrante('cotiza');
  const conv = await repo.conversacion(ev.conversacionId);
  const r = await vendedor.cotizar({ partidas: [{ clave: 'OCULTO-AA', cantidad: 1 }, { clave: 'SINPRECIO-AA', cantidad: 1 }], entrega: 'tienda' }, { cat, conv, cfg: await repo.config(), repo });
  assert.match(r.error, /OCULTO-AA: no está en el catálogo publicado; SINPRECIO-AA: sin precio publicado/);
});

test('solicitud de descuento crea una aprobación pendiente', async () => {
  const d = deps({ guion: [{ herramienta: 'solicitar_descuento', entrada: { claves: ['2904-20-AA'], solicitud: '¿me lo dejas en menos?', motivo: 'Compra 2' } }, { texto: 'Lo consulto con el encargado y te aviso por aquí.' }] });
  await atender(await entrante('me haces descuento?'), d);
  const [a] = await repo.listarAprobaciones({ estado: 'pendiente' });
  assert.equal(a.tipo, 'descuento');
});

test('fuera de horario con modo "mensaje": avisa el horario una sola vez', async () => {
  await repo.guardarConfig('horario', { dias: { lun: null, mar: null, mie: null, jue: null, vie: null, sab: null, dom: null }, fuera_de_horario: 'mensaje' }, 'prueba');
  const d = deps({ guion: [{ texto: 'no debería usarse' }] });
  await atender(await entrante('hola'), d);
  await atender(await entrante('sigues?'), d);
  assert.equal(d.wa.enviados.length, 1);
  assert.match(d.wa.enviados[0].texto, /horario/);
  assert.equal(d.cliente.llamadas.length, 0);
});

test('presupuesto diario agotado: pasa a humano sin llamar a Claude', async () => {
  await repo.guardarConfig('limites', { presupuesto_diario_usd: 0.001 }, 'prueba');
  await repo.registrarUso({ agente: 'vendedor', modelo: 'claude-opus-5-5', uso: { input_tokens: 10000 } });
  const d = deps({ guion: [{ texto: 'x' }] });
  const ev = await entrante('hola');
  assert.equal((await atender(ev, d)).resultado, 'presupuesto');
  assert.equal(d.cliente.llamadas.length, 0);
  assert.equal((await repo.conversacion(ev.conversacionId)).modo, 'humano');
});

test('rechazo del modelo: respuesta segura y transferencia', async () => {
  const d = deps({ guion: [{ rechazo: true }] });
  const ev = await entrante('...');
  await atender(ev, d);
  assert.match(d.wa.enviados[0].texto, /asesor/);
  assert.equal((await repo.conversacion(ev.conversacionId)).modo, 'humano');
});

test('falla al enviar por WhatsApp: se registra y pasa a humano', async () => {
  const wa = { async enviarTexto() { const e = new Error('360dialog 400 (código 131047): Re-engagement message'); e.codigo = 131047; throw e; }, async escribiendo() {} };
  const d = deps({ guion: [{ texto: 'Hola' }], wa });
  const ev = await entrante('hola');
  await atender(ev, d);
  assert.equal((await repo.conversacion(ev.conversacionId)).modo, 'humano');
  const [e] = await repo.listarErrores(1);
  assert.match(e.mensaje, /131047/);
});

test('palabras que piden un asesor: transferencia inmediata sin IA', async () => {
  const d = deps({ guion: [{ texto: 'no debería usarse' }] });
  const ev = await entrante('quiero hablar con un asesor por favor');
  assert.equal((await atender(ev, d)).resultado, 'transferido');
  assert.equal(d.cliente.llamadas.length, 0);
  assert.match(d.wa.enviados[0].texto, /asesor/);
  assert.equal((await repo.conversacion(ev.conversacionId)).modo, 'humano');
  assert.equal(pideAsesor('el taladro es para una persona que trabaja', DEFAULTS.humano.palabras_transferencia), null);
  assert.equal(pideAsesor('YA PAGUÉ, ¿me confirman?', DEFAULTS.humano.palabras_transferencia), 'ya pague');
  assert.equal(pideAsesor('quiero un taladro para humanos', ['humano']), null, 'solo palabras completas');
});

test('horario de atención en hora de Chihuahua', () => {
  const h = DEFAULTS.horario;
  assert.equal(dentroDeHorario(h, new Date('2026-10-12T16:00:00Z')), true); // lunes 10:00 en Chihuahua (UTC-6)
  assert.equal(dentroDeHorario(h, new Date('2026-10-12T02:00:00Z')), false); // domingo 20:00
  assert.equal(dentroDeHorario(h, new Date('2026-10-17T19:30:00Z')), true); // sábado 13:30
  assert.equal(dentroDeHorario(h, new Date('2026-10-17T20:30:00Z')), false); // sábado 14:30
});

test('tiempos de respuesta configurables por tipo de mensaje', () => {
  assert.equal(vendedor.clasificarMensaje(['Hola buenas tardes']), 'saludo');
  assert.equal(vendedor.clasificarMensaje(['me cotizas 3 baterias?']), 'cotizacion');
  assert.equal(vendedor.clasificarMensaje(['tienen rotomartillo m18?']), 'consulta');
  const t = DEFAULTS.tiempos;
  assert.equal(vendedor.esperaObjetivo('saludo', t, () => 0), 5000);
  assert.equal(vendedor.esperaObjetivo('cotizacion', t, () => 1), 45000);
});

test('lectura de avisos de 360dialog: mensajes, estados y ecos de la app', () => {
  const ev = leerWebhook({
    object: 'whatsapp_business_account',
    entry: [{ id: '1', changes: [
      { field: 'messages', value: { messaging_product: 'whatsapp', contacts: [{ profile: { name: 'Ana' }, wa_id: '5216141112233' }], messages: [
        { from: '5216141112233', id: 'wamid.a', timestamp: '1760000000', type: 'text', text: { body: 'hola' } },
        { from: '5216141112233', id: 'wamid.b', timestamp: '1760000001', type: 'audio', audio: { id: 'x' } },
        { from: '5216141112233', id: 'wamid.c', timestamp: '1760000002', type: 'reaction', reaction: { emoji: '👍' } },
      ] } },
      { field: 'messages', value: { statuses: [{ id: 'wamid.out1', status: 'failed', errors: [{ code: 131047, title: 'Re-engagement message' }] }] } },
      { field: 'smb_message_echoes', value: { message_echoes: [{ from: '526141927887', to: '5216141112233', id: 'wamid.eco', timestamp: '1760000003', type: 'text', text: { body: 'Yo te atiendo' } }] } },
    ] }],
  });
  assert.deepEqual(ev.map((e) => e.tipo), ['mensaje', 'mensaje', 'estado', 'eco']);
  assert.equal(ev[0].nombre, 'Ana');
  assert.match(ev[1].texto, /audio/);
  assert.equal(ev[2].error, '131047 Re-engagement message');
  assert.equal(ev[3].waIdCliente, '5216141112233');
});

test('envío real deshabilitado por defecto y lista de números de prueba', async () => {
  let llamadas = 0;
  const f = async () => { llamadas++; return { ok: true, json: async () => ({ messages: [{ id: 'wamid.x' }] }) }; };
  const apagado = clienteWhatsApp({ fetchImpl: f, apiKey: 'k', modo: { habilitado: false, soloNumeros: [] } });
  assert.equal((await apagado.enviarTexto('5216141112233', 'hola')).simulado, true);
  const prueba = clienteWhatsApp({ fetchImpl: f, apiKey: 'k', modo: { habilitado: true, soloNumeros: ['5216140000000'] } });
  assert.equal((await prueba.enviarTexto('5216141112233', 'hola')).simulado, true);
  assert.equal(llamadas, 0);
  const r = await prueba.enviarTexto('5216140000000', 'hola');
  assert.deepEqual(r, { id: 'wamid.x', simulado: false });
  assert.equal(llamadas, 1);
});
