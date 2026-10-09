import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { basePruebas, vaciar } from './ayuda/pg.js';
import { claudeFalso } from './ayuda/claude-falso.js';
import * as repo from '../lib/repo.js';
import { cerrarDb } from '../lib/db.js';
import { cargarCatalogo, olvidarCatalogo } from '../lib/catalogo/index.js';
import { construirCatalogo } from '../lib/catalogo/modelo.js';
import { revisarSitio } from '../lib/agentes/supervisor.js';
import { revisarInventario } from '../lib/agentes/inventarios.js';
import { reporteDiario } from '../lib/agentes/administrador.js';
import { ejecutarPendientes, programar } from '../lib/tareas.js';
import { decidir } from '../lib/aprobaciones.js';
import { DEFAULTS } from '../lib/config.js';
import * as F from './fixtures/catalogo.js';

let sql;
before(async () => { sql = await basePruebas(); });
beforeEach(async () => { await vaciar(sql); olvidarCatalogo(); });
after(async () => { await cerrarDb(); });

const CFG = structuredClone(DEFAULTS);
const HOME = '<html><head><title>Denmor</title></head><body><a href="https://wa.me/526141927887">WhatsApp</a></body></html>';
// catálogo de 40+ modelos: el de prueba repetido con claves distintas, con existencias para todas
function coreGrande() {
  const c = F.core();
  const rows = [];
  for (let k = 0; k < 4; k++) for (const r of c.rows) { const x = r.slice(); if (k) { x[0] = `${x[0]}-${k}`; x[1] = `${x[1]}-${k}`; } rows.push(x); }
  return { ...c, rows };
}
function existenciasGrandes(actualizado) {
  const e = F.existencias();
  for (const r of coreGrande().rows) if (!e.existencias[r[0]]) e.existencias[r[0]] = { 1: 0, 2: 1, 3: 0 };
  e.actualizado = actualizado;
  return e;
}
function sitioFalso({ caido = false, sinWhatsApp = false, existenciasViejas = false } = {}) {
  return async (url) => {
    const u = url.split('?')[0];
    const html = (b, st = 200) => ({ ok: st === 200, status: st, text: async () => b, json: async () => ({}) });
    const js = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
    if (u === CFG.catalogo.core) return js(coreGrande());
    if (u === CFG.catalogo.ajustes) return js(F.ajustes({ promo: false }));
    if (u === CFG.catalogo.existencias) return js(existenciasGrandes(existenciasViejas ? '2020-01-01T00:00:00' : new Date(Date.now() - 20 * 60e3).toISOString()));
    if (u === 'https://denmorherramientas.com/') return caido ? html('', 503) : html(sinWhatsApp ? HOME.replace('wa.me/526141927887', '') : HOME);
    if (u === 'https://denmorherramientas.com/nosotros/') return html(HOME);
    if (u.startsWith('https://denmorherramientas.com/p/')) return html(`<title>${decodeURIComponent(u.split('/p/')[1])}</title>`);
    if (u === 'https://denmorherramientas.com/api/estado') return js({ ok: true, version: 'x', almacen: true });
    return html('', 404);
  };
}

test('supervisor: todo en orden', async () => {
  const r = await revisarSitio(CFG, { fetchImpl: sitioFalso() });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.checks.length, 7);
});

test('supervisor: detecta sitio caído, falta de botón de WhatsApp y existencias viejas', async () => {
  const a = await revisarSitio(CFG, { fetchImpl: sitioFalso({ caido: true }) });
  assert.match(a.checks[0].detalle, /503/);
  const b = await revisarSitio(CFG, { fetchImpl: sitioFalso({ sinWhatsApp: true }) });
  assert.match(b.checks[0].detalle, /WhatsApp/);
  olvidarCatalogo();
  const c = await revisarSitio(CFG, { fetchImpl: sitioFalso({ existenciasViejas: true }) });
  assert.ok(c.checks.find((x) => x.nombre.startsWith('Existencias') && !x.ok));
});

test('inventarios: fotos, precios, duplicados y claves de SICAR fuera del catálogo', () => {
  const ex = F.existencias();
  ex.existencias['NUEVO-123-AA'] = { 1: 0, 2: 3, 3: 0 };
  ex.existencias['SOLO-HANDYMAN-AA'] = { 4: 7 };
  const cat = construirCatalogo(F.core(), F.ajustes(), ex);
  const r = revisarInventario(cat, ex);
  assert.deepEqual(r.hallazgos.sinFoto.map((x) => x.clave), ['2767-20-D']);
  assert.deepEqual(r.hallazgos.sinPrecio.map((x) => x.clave), ['SINPRECIO-AA']);
  assert.deepEqual(r.hallazgos.enSicarNoCatalogo.map((x) => x.clave), ['NUEVO-123-AA', '48-59-1808-A'], 'la sucursal handyman no cuenta');
  assert.ok(!r.hallazgos.sinFoto.some((x) => x.clave.startsWith('OCULTO')), 'ocultos no se reportan');
  assert.match(r.resumen, /sin fotografía/);
});

test('administrador: reporte diario con datos reales', async () => {
  const e = await repo.registrarEntrante({ waId: '5216140000001', nombre: 'Ana', waMessageId: 'w1', texto: 'hola' });
  await repo.crearCotizacion({ conversacionId: e.conversacionId, partidas: [{ clave: 'X', cantidad: 1, precio_unitario: 500 }], total: 500, creadoPor: 'vendedor' });
  await repo.marcarInteres(e.conversacionId, 'Quiere el 2904', true);
  const r = await reporteDiario();
  assert.match(r.texto, /Conversaciones atendidas: 1/);
  assert.match(r.texto, /Cotizaciones: 1 por \$500/);
  assert.equal(r.interesados[0].nota, 'Quiere el 2904');
});

test('tareas programadas: no se duplican y se ejecutan', async () => {
  assert.ok(await programar('revision_inventario', { cadaHoras: 20 }));
  assert.equal(await programar('revision_inventario', { cadaHoras: 20 }), null);
  const fetchImpl = sitioFalso();
  const n = await ejecutarPendientes({ cliente: claudeFalso([{ texto: 'x' }]), catalogo: () => cargarCatalogo({ ...CFG.catalogo, cache_minutos: 0 }, { fetchImpl }), fetchImpl });
  assert.equal(n, 1);
  const [t] = await repo.listarTareas();
  assert.equal(t.estado, 'completada');
  const [rep] = await repo.listarReportes({ agente: 'inventarios' });
  assert.match(rep.titulo, /hallazgos/);
});

test('pausa general: no se toman tareas; agente apagado tampoco', async () => {
  await programar('reporte_diario', { cadaHoras: 20 });
  await repo.guardarConfig('agentes', { pausa_global: true }, 'p');
  assert.equal(await ejecutarPendientes({ cliente: claudeFalso([{ texto: 'x' }]) }), 0);
  await repo.guardarConfig('agentes', { pausa_global: false, administrador: { activo: false } }, 'p');
  assert.equal(await ejecutarPendientes({ cliente: claudeFalso([{ texto: 'x' }]) }), 0);
  assert.equal((await repo.listarTareas({ estado: 'pendiente' })).length, 1);
});

test('coordinador: la orden se convierte en tareas; las sensibles esperan aprobación', async () => {
  const o = await repo.crearOrden('Revisa el sitio y manda promo de baterías a los clientes', 'dueño@denmor');
  await repo.crearTarea({ agente: 'coordinador', trabajo: 'interpretar_orden', entrada: { orden_id: o.id }, titulo: 'Interpretar' });
  const cliente = claudeFalso([{ json: { respuesta: 'Listo', tareas: [
    { agente: 'supervisor', titulo: 'Revisar sitio', descripcion: '-', prioridad: 'alta', requiere_aprobacion: false },
    { agente: 'vendedor', titulo: 'Promo de baterías', descripcion: 'Proponer mensajes', prioridad: 'normal', requiere_aprobacion: true },
    { agente: 'contador', titulo: 'Inventado', descripcion: '-', prioridad: 'normal', requiere_aprobacion: false },
  ], no_se_puede: ['Facturar'] } }]);
  // solo se ejecuta la interpretación (el supervisor queda pendiente porque se apaga para esta prueba)
  await repo.guardarConfig('agentes', { supervisor: { activo: false } }, 'p');
  await ejecutarPendientes({ cliente, catalogo: async () => null });
  assert.equal(cliente.llamadas[0].output_config.format.type, 'json_schema');
  const tareas = await repo.listarTareas();
  assert.ok(tareas.find((t) => t.agente === 'supervisor' && t.estado === 'pendiente' && t.trabajo === 'revision_sitio'));
  const ven = tareas.find((t) => t.agente === 'vendedor');
  assert.equal(ven.estado, 'esperando_aprobacion');
  assert.ok(!tareas.some((t) => t.agente === 'contador'));
  const [ap] = await repo.listarAprobaciones({ estado: 'pendiente' });
  assert.equal(ap.tarea_id, ven.id);
  const r = await decidir(ap.id, 'rechazada', 'dueño@denmor');
  assert.equal(r.ok, true);
  assert.equal((await repo.tarea(ven.id)).estado, 'cancelada');
  assert.equal((await decidir(ap.id, 'aprobada', 'dueño@denmor')).ok, false, 'no se decide dos veces');
});

test('seguimiento: solo a quienes aceptaron, tras aprobación y dentro de 24 h', async () => {
  const a = await repo.registrarEntrante({ waId: '5216140000001', waMessageId: 'a1', texto: 'me interesa' });
  const b = await repo.registrarEntrante({ waId: '5216140000002', waMessageId: 'b1', texto: 'me interesa', fecha: new Date(Date.now() - 30 * 3600e3) });
  const c = await repo.registrarEntrante({ waId: '5216140000003', waMessageId: 'c1', texto: 'me interesa' });
  await repo.marcarInteres(a.conversacionId, 'x', true);
  await repo.marcarInteres(b.conversacionId, 'x', true);
  await repo.marcarInteres(c.conversacionId, 'x', false);
  const t = await repo.crearTarea({ agente: 'vendedor', titulo: 'Seguimiento' });
  const cliente = claudeFalso([
    { herramienta: 'proponer_seguimiento', entrada: { mensajes: [a, b, c].map((x) => ({ conversacion_id: x.conversacionId, texto: '¿Pudiste revisar la cotización?' })) } },
    { texto: 'Propuse 2 mensajes.' },
  ]);
  const enviados = [];
  const wa = { enviarTexto: async (to, texto) => { enviados.push(to); return { id: 'out' + enviados.length, simulado: false }; } };
  await ejecutarPendientes({ cliente, wa, catalogo: async () => null });
  assert.equal((await repo.tarea(t.id)).estado, 'completada');
  const [ap] = await repo.listarAprobaciones({ estado: 'pendiente' });
  assert.equal(ap.tipo, 'mensaje_masivo');
  assert.equal(ap.detalle.mensajes.length, 2, 'el que no aceptó seguimiento se excluye');
  assert.equal(enviados.length, 0, 'nada se envía antes de aprobar');
  await decidir(ap.id, 'aprobada', 'dueño');
  await ejecutarPendientes({ cliente: claudeFalso([{ texto: 'x' }]), wa, catalogo: async () => null });
  assert.deepEqual(enviados, ['5216140000001'], 'el de hace 30 h queda fuera de la ventana de 24 h');
  const [envio] = (await repo.listarTareas()).filter((x) => x.trabajo === 'enviar_seguimiento');
  assert.match(envio.resultado, /1 enviado.*24 h/);
});

test('agentes con IA no pueden usar herramientas fuera de su papel', async () => {
  const t = await repo.crearTarea({ agente: 'programador', titulo: 'Analiza errores' });
  const cliente = claudeFalso([{ herramienta: 'proponer_publicacion', entrada: { canal: 'instagram', titulo: 'x', texto: 'x', claves: [] } }, { texto: 'No pude.' }]);
  await ejecutarPendientes({ cliente, catalogo: async () => null });
  assert.deepEqual(cliente.llamadas[0].tools.map((x) => x.name).sort(), ['listar_errores', 'proponer_cambio', 'resumen_operacion', 'ver_reportes']);
  assert.equal((await repo.listarAprobaciones()).length, 0);
  assert.equal((await repo.tarea(t.id)).estado, 'completada');
});

test('descuento aprobado: la conversación pasa a una persona con la decisión', async () => {
  const e = await repo.registrarEntrante({ waId: '5216140000001', waMessageId: 'd1', texto: 'descuento?' });
  const ap = await repo.solicitarAprobacion({ tipo: 'descuento', titulo: 'x', solicitadoPor: 'vendedor', conversacionId: e.conversacionId });
  await decidir(ap.id, 'aprobada', 'dueño', '5 % en 2904-20-AA');
  const c = await repo.conversacion(e.conversacionId);
  assert.equal(c.modo, 'humano');
  assert.match(c.motivo_modo, /APROBADO: 5 % en 2904-20-AA/);
});
