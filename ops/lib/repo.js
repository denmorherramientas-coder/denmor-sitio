// Acceso a datos: todas las consultas de DENMOR AI OPERATIONS en un solo lugar.
import { db } from './db.js';
import { configCompleta, combinar, DEFAULTS, ZONA, costoUsd } from './config.js';
import { limpiarObjeto, limpiarSecretos, recortar, idCorto } from './seguridad.js';

const j = (v) => db().json(v ?? {});

/* ---------------- configuración ---------------- */

let cacheConfig = { t: 0, v: null };
export async function config({ fresca = false } = {}) {
  if (!fresca && cacheConfig.v && Date.now() - cacheConfig.t < 15000) return cacheConfig.v;
  const filas = await db()`select clave, valor from ops.configuracion`;
  cacheConfig = { t: Date.now(), v: configCompleta(filas) };
  return cacheConfig.v;
}

export async function guardarConfig(clave, valor, por) {
  if (!(clave in DEFAULTS)) throw new Error(`Sección de configuración desconocida: ${clave}`);
  // se combina con lo ya guardado: cambiar una opción no borra las demás de la misma sección
  await db().begin(async (sql) => {
    const [prev] = await sql`select valor from ops.configuracion where clave = ${clave} for update`;
    const nuevo = prev ? combinar(prev.valor, valor) : valor;
    await sql`insert into ops.configuracion (clave, valor, actualizado, actualizado_por) values (${clave}, ${sql.json(nuevo)}, now(), ${por})
      on conflict (clave) do update set valor = excluded.valor, actualizado = now(), actualizado_por = excluded.actualizado_por`;
  });
  cacheConfig = { t: 0, v: null };
  await registrar(por, 'config.guardar', 'configuracion', clave, { valor });
}

/* ---------------- operadores del panel ---------------- */

export async function operador(email) {
  const [o] = await db()`select email, nombre, rol from ops.operadores where email = ${String(email || '').toLowerCase()} and activo`;
  return o || null;
}

/* ---------------- bitácora, errores y consumo ---------------- */

export async function registrar(actor, accion, entidad = null, entidadId = null, detalle = {}) {
  await db()`insert into ops.bitacora (actor, accion, entidad, entidad_id, detalle)
    values (${recortar(actor, 80)}, ${recortar(accion, 80)}, ${entidad}, ${entidadId == null ? null : String(entidadId)}, ${j(limpiarObjeto(detalle))})`;
}

export async function registrarError(origen, error, detalle = {}) {
  const mensaje = limpiarSecretos(error?.message || String(error)).slice(0, 2000);
  try {
    await db()`insert into ops.errores (origen, mensaje, detalle) values (${origen}, ${mensaje}, ${j(limpiarObjeto(detalle))})`;
  } catch (e) {
    console.error('No se pudo guardar el error', origen, mensaje);
  }
}

export async function registrarUso({ agente, modelo, uso, conversacionId = null, tareaId = null }) {
  const u = {
    tokens_entrada: uso.input_tokens || 0,
    tokens_salida: uso.output_tokens || 0,
    tokens_cache_lectura: uso.cache_read_input_tokens || 0,
    tokens_cache_escritura: uso.cache_creation_input_tokens || 0,
  };
  const costo = costoUsd(modelo, u);
  await db()`insert into ops.uso_ia (agente, modelo, tokens_entrada, tokens_salida, tokens_cache_lectura, tokens_cache_escritura, costo_usd, conversacion_id, tarea_id)
    values (${agente}, ${modelo}, ${u.tokens_entrada}, ${u.tokens_salida}, ${u.tokens_cache_lectura}, ${u.tokens_cache_escritura}, ${costo}, ${conversacionId}, ${tareaId})`;
  return costo;
}

export async function gastoHoy() {
  const [r] = await db()`select coalesce(sum(costo_usd), 0)::float as usd from ops.uso_ia where (creado at time zone ${ZONA})::date = (now() at time zone ${ZONA})::date`;
  return r.usd;
}

/* ---------------- WhatsApp: contactos, conversaciones y mensajes ---------------- */

const SEL_CONV = (sql) => sql`
  select c.*, k.wa_id, k.nombre, k.interesado, k.nota_interes, k.acepta_seguimiento
  from ops.conversaciones c join ops.contactos k on k.id = c.contacto_id`;

export async function conversacion(id) {
  const sql = db();
  const [c] = await sql`${SEL_CONV(sql)} where c.id = ${id}`;
  return c || null;
}

export async function conversacionPorWaId(waId) {
  const sql = db();
  const [c] = await sql`${SEL_CONV(sql)} where k.wa_id = ${waId}`;
  return c || null;
}

async function asegurarConversacion(sql, waId, nombre) {
  const [k] = await sql`insert into ops.contactos (wa_id, nombre) values (${waId}, ${nombre || null})
    on conflict (wa_id) do update set nombre = coalesce(excluded.nombre, ops.contactos.nombre), actualizado = now()
    returning id`;
  const [c] = await sql`insert into ops.conversaciones (contacto_id) values (${k.id})
    on conflict (contacto_id) do update set contacto_id = excluded.contacto_id
    returning id`;
  return c.id;
}

// Mensaje del cliente. Devuelve { duplicado: true } si ese mensaje de WhatsApp ya se había recibido.
export async function registrarEntrante({ waId, nombre, waMessageId, tipo = 'text', texto, meta = {}, fecha = new Date() }) {
  return db().begin(async (sql) => {
    const convId = await asegurarConversacion(sql, waId, nombre);
    const [m] = await sql`insert into ops.mensajes (conversacion_id, direccion, autor, tipo, texto, wa_message_id, meta, creado)
      values (${convId}, 'entrante', 'cliente', ${tipo}, ${recortar(texto, 4000)}, ${waMessageId}, ${sql.json(meta)}, ${fecha})
      on conflict (wa_message_id) do nothing returning id, creado`;
    if (!m) return { duplicado: true, conversacionId: convId };
    await sql`update ops.conversaciones set ultimo_entrante = greatest(coalesce(ultimo_entrante, ${fecha}), ${fecha}) where id = ${convId}`;
    return { duplicado: false, conversacionId: convId, mensajeId: m.id, creado: m.creado };
  });
}

// Mensaje que el propietario escribió desde la app WhatsApp Business (evento smb_message_echoes).
export async function registrarEcoHumano({ waIdCliente, waMessageId, tipo = 'text', texto, fecha = new Date(), detener = true }) {
  return db().begin(async (sql) => {
    const convId = await asegurarConversacion(sql, waIdCliente, null);
    const [m] = await sql`insert into ops.mensajes (conversacion_id, direccion, autor, tipo, texto, wa_message_id, creado)
      values (${convId}, 'saliente', 'humano_app', ${tipo}, ${recortar(texto, 4000)}, ${waMessageId}, ${fecha})
      on conflict (wa_message_id) do nothing returning id`;
    if (!m) return { duplicado: true, conversacionId: convId };
    await sql`update ops.conversaciones set ultimo_humano = ${fecha}, ultimo_saliente = ${fecha} where id = ${convId}`;
    if (detener) {
      const r = await sql`update ops.conversaciones set modo = 'humano', motivo_modo = 'Respondiste desde WhatsApp Business', modo_desde = now()
        where id = ${convId} and modo = 'asistente' returning id`;
      if (r.length) await sql`insert into ops.bitacora (actor, accion, entidad, entidad_id, detalle) values ('whatsapp', 'conversacion.humano', 'conversacion', ${convId}, ${sql.json({ motivo: 'eco de la app' })})`;
    }
    return { duplicado: false, conversacionId: convId };
  });
}

export async function registrarSaliente({ conversacionId, autor, texto, waMessageId = null, estado = null, error = null, meta = {} }) {
  const sql = db();
  const [m] = await sql`insert into ops.mensajes (conversacion_id, direccion, autor, texto, wa_message_id, estado_entrega, error, meta)
    values (${conversacionId}, 'saliente', ${autor}, ${recortar(texto, 4000)}, ${waMessageId}, ${estado}, ${error ? limpiarSecretos(error).slice(0, 500) : null}, ${sql.json(meta)})
    returning id`;
  if (!error) await sql`update ops.conversaciones set ultimo_saliente = now() where id = ${conversacionId}`;
  return m.id;
}

export async function actualizarEntrega(waMessageId, estado, error = null) {
  await db()`update ops.mensajes set estado_entrega = ${estado}, error = coalesce(${error}, error) where wa_message_id = ${waMessageId}`;
}

export async function historial(conversacionId, limite = 30) {
  const filas = await db()`select id, direccion, autor, tipo, texto, creado, estado_entrega, error from ops.mensajes
    where conversacion_id = ${conversacionId} order by creado desc limit ${limite}`;
  return filas.reverse();
}

// Mensajes del cliente que todavía no tienen respuesta
export async function sinResponder(conversacionId) {
  return db()`select m.id, m.texto, m.tipo, m.creado, m.wa_message_id from ops.mensajes m join ops.conversaciones c on c.id = m.conversacion_id
    where m.conversacion_id = ${conversacionId} and m.direccion = 'entrante'
      and m.creado > coalesce(c.respondido_hasta, '-infinity'::timestamptz)
      and m.creado > coalesce(c.ultimo_humano, '-infinity'::timestamptz)
    order by m.creado`;
}

export async function marcarRespondido(conversacionId, hasta) {
  await db()`update ops.conversaciones set respondido_hasta = greatest(coalesce(respondido_hasta, ${hasta}), ${hasta}) where id = ${conversacionId}`;
}

// Candado para que solo un proceso conteste a la vez en cada conversación
export async function tomarCandado(conversacionId, segundos = 120) {
  const r = await db()`update ops.conversaciones set procesando_hasta = now() + make_interval(secs => ${segundos})
    where id = ${conversacionId} and (procesando_hasta is null or procesando_hasta < now()) returning id`;
  return r.length > 0;
}

export async function soltarCandado(conversacionId) {
  await db()`update ops.conversaciones set procesando_hasta = null where id = ${conversacionId}`;
}

export async function cambiarModo(conversacionId, modo, motivo, actor) {
  const r = await db()`update ops.conversaciones set modo = ${modo}, motivo_modo = ${recortar(motivo, 300)}, modo_desde = now()
    where id = ${conversacionId} returning id`;
  if (r.length) await registrar(actor, modo === 'humano' ? 'conversacion.tomar' : 'conversacion.reactivar', 'conversacion', conversacionId, { motivo });
  return r.length > 0;
}

// Reactiva el asistente en conversaciones atendidas por humano sin actividad humana reciente (si está configurado)
export async function reactivarInactivas(horas) {
  if (!(horas > 0)) return 0;
  const r = await db()`update ops.conversaciones set modo = 'asistente', motivo_modo = 'Reactivado automáticamente por inactividad', modo_desde = now()
    where modo = 'humano' and coalesce(ultimo_humano, modo_desde) < now() - make_interval(hours => ${horas}) returning id`;
  return r.length;
}

// Cuenta respuestas del asistente por contacto y día (límite anti-abuso)
export async function contarRespuesta(conversacionId) {
  const [r] = await db()`update ops.conversaciones set
      respuestas_hoy = case when respuestas_dia = (now() at time zone ${ZONA})::date then respuestas_hoy + 1 else 1 end,
      respuestas_dia = (now() at time zone ${ZONA})::date
    where id = ${conversacionId} returning respuestas_hoy`;
  return r ? r.respuestas_hoy : 0;
}

export async function respuestasHoy(conversacionId) {
  const [r] = await db()`select case when respuestas_dia = (now() at time zone ${ZONA})::date then respuestas_hoy else 0 end as n
    from ops.conversaciones where id = ${conversacionId}`;
  return r ? r.n : 0;
}

export async function listarConversaciones({ modo = null, buscar = '', limite = 50 } = {}) {
  const sql = db();
  const q = buscar ? `%${buscar}%` : null;
  return sql`
    select c.id, c.modo, c.motivo_modo, c.ultimo_entrante, c.ultimo_saliente, c.ultimo_humano, k.wa_id, k.nombre, k.interesado,
      (select texto from ops.mensajes m where m.conversacion_id = c.id order by creado desc limit 1) as ultimo_texto,
      (select autor from ops.mensajes m where m.conversacion_id = c.id order by creado desc limit 1) as ultimo_autor,
      (select count(*)::int from ops.mensajes m where m.conversacion_id = c.id and m.direccion = 'entrante'
         and m.creado > greatest(coalesce(c.ultimo_saliente, '-infinity'::timestamptz), coalesce(c.respondido_hasta, '-infinity'::timestamptz))) as pendientes
    from ops.conversaciones c join ops.contactos k on k.id = c.contacto_id
    where (${modo}::text is null or c.modo = ${modo})
      and (${q}::text is null or k.nombre ilike ${q} or k.wa_id like ${q})
    order by greatest(c.ultimo_entrante, c.ultimo_saliente) desc nulls last
    limit ${limite}`;
}

export async function marcarInteres(conversacionId, nota, aceptaSeguimiento = false) {
  await db()`update ops.contactos set interesado = true, nota_interes = ${recortar(nota, 1000)}, actualizado = now(),
      acepta_seguimiento = acepta_seguimiento or ${!!aceptaSeguimiento}
    where id = (select contacto_id from ops.conversaciones where id = ${conversacionId})`;
}

export async function guardarNombre(conversacionId, nombre) {
  await db()`update ops.contactos set nombre = ${recortar(nombre, 80)}, actualizado = now()
    where id = (select contacto_id from ops.conversaciones where id = ${conversacionId})`;
}

/* ---------------- cotizaciones ---------------- */

export async function crearCotizacion({ conversacionId = null, partidas, total, entrega = 'tienda', vigenciaDias = 3, creadoPor }) {
  const sql = db();
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: '2-digit', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/-/g, '');
  const folio = `DNC-${hoy}-${idCorto(4)}`;
  const [c] = await sql`insert into ops.cotizaciones (folio, conversacion_id, contacto_id, partidas, total, entrega, vigencia, creado_por)
    values (${folio}, ${conversacionId}, (select contacto_id from ops.conversaciones where id = ${conversacionId}), ${sql.json(partidas)}, ${total}, ${entrega},
      (now() at time zone ${ZONA})::date + ${vigenciaDias}::int, ${creadoPor})
    returning id, folio, vigencia, total`;
  await registrar(creadoPor, 'cotizacion.crear', 'cotizacion', c.id, { folio, total });
  return c;
}

export async function listarCotizaciones(limite = 50) {
  return db()`select q.id, q.folio, q.partidas, q.total::float as total, q.entrega, q.estado, q.vigencia, q.creado, q.creado_por, k.nombre, k.wa_id, q.conversacion_id
    from ops.cotizaciones q left join ops.contactos k on k.id = q.contacto_id order by q.creado desc limit ${limite}`;
}

/* ---------------- órdenes y tareas ---------------- */

export async function crearOrden(texto, por) {
  const [o] = await db()`insert into ops.ordenes (texto, creado_por) values (${recortar(texto, 4000)}, ${por}) returning *`;
  await registrar(por, 'orden.crear', 'orden', o.id, { texto: recortar(texto, 300) });
  return o;
}

export async function actualizarOrden(id, estado, interpretacion) {
  await db()`update ops.ordenes set estado = ${estado}, interpretacion = ${j(interpretacion)} where id = ${id}`;
}

export async function orden(id) {
  const [o] = await db()`select * from ops.ordenes where id = ${id}`;
  return o || null;
}

export async function listarOrdenes(limite = 30) {
  return db()`select * from ops.ordenes order by creado desc limit ${limite}`;
}

export async function crearTarea({ agente, titulo, descripcion = '', prioridad = 'normal', origen = 'propietario', ordenId = null, creadoPor = null, estado = 'pendiente', trabajo = 'libre', entrada = {} }) {
  const [t] = await db()`insert into ops.tareas (agente, trabajo, entrada, titulo, descripcion, prioridad, origen, orden_id, creado_por, estado)
    values (${agente}, ${trabajo}, ${j(entrada)}, ${recortar(titulo, 200)}, ${recortar(descripcion, 4000)}, ${prioridad}, ${origen}, ${ordenId}, ${creadoPor}, ${estado}) returning *`;
  await registrar(creadoPor || agente, 'tarea.crear', 'tarea', t.id, { agente, titulo, prioridad });
  return t;
}

// Toma la siguiente tarea pendiente (más urgente primero) de forma segura entre procesos
export async function tomarTarea(agentes) {
  const sql = db();
  const [t] = await sql`update ops.tareas set estado = 'en_proceso', iniciada = now(), intentos = intentos + 1
    where id = (select id from ops.tareas where estado = 'pendiente' and agente = any(${agentes})
      order by case prioridad when 'urgente' then 0 when 'alta' then 1 when 'normal' then 2 else 3 end, creado
      limit 1 for update skip locked)
    returning *`;
  return t || null;
}

export async function terminarTarea(id, { estado, resultado = '', datos = null, actor = 'sistema' }) {
  await db()`update ops.tareas set estado = ${estado}, resultado = ${recortar(limpiarSecretos(resultado), 20000)}, resultado_datos = ${datos ? j(limpiarObjeto(datos)) : null},
    terminada = case when ${estado} in ('completada', 'fallida', 'cancelada') then now() else terminada end where id = ${id}`;
  await registrar(actor, `tarea.${estado}`, 'tarea', id, {});
}

export async function listarTareas({ estado = null, limite = 100 } = {}) {
  return db()`select * from ops.tareas where (${estado}::text is null or estado = ${estado})
    order by case estado when 'en_proceso' then 0 when 'pendiente' then 1 when 'esperando_aprobacion' then 2 else 3 end,
      case prioridad when 'urgente' then 0 when 'alta' then 1 when 'normal' then 2 else 3 end, creado desc limit ${limite}`;
}

// Tareas que quedaron "en proceso" por una falla (más de 20 minutos) vuelven a pendientes, máximo 3 intentos
export async function recuperarTareasAtoradas() {
  await db()`update ops.tareas set estado = case when intentos >= 3 then 'fallida' else 'pendiente' end,
      resultado = case when intentos >= 3 then 'Se interrumpió 3 veces; revisar errores.' else resultado end
    where estado = 'en_proceso' and iniciada < now() - interval '20 minutes'`;
}

export async function tarea(id) {
  const [t] = await db()`select * from ops.tareas where id = ${id}`;
  return t || null;
}

export async function cambiarEstadoTarea(id, estado, actor) {
  const [t] = await db()`update ops.tareas set estado = ${estado}, terminada = case when ${estado} in ('completada', 'fallida', 'cancelada') then now() else terminada end
    where id = ${id} and estado not in ('completada', 'fallida', 'cancelada') returning *`;
  if (t) await registrar(actor, `tarea.${estado}`, 'tarea', id, {});
  return t || null;
}

// Ya existe una tarea programada de este trabajo creada en las últimas N horas (evita duplicados)
export async function tareaReciente(trabajo, horas) {
  const [t] = await db()`select id from ops.tareas where trabajo = ${trabajo} and origen = 'programada' and creado > now() - make_interval(hours => ${horas}) limit 1`;
  return !!t;
}

/* ---------------- aprobaciones ---------------- */

export async function solicitarAprobacion({ tipo, titulo, detalle = {}, solicitadoPor, conversacionId = null, tareaId = null }) {
  const [a] = await db()`insert into ops.aprobaciones (tipo, titulo, detalle, solicitado_por, conversacion_id, tarea_id)
    values (${tipo}, ${recortar(titulo, 200)}, ${j(limpiarObjeto(detalle))}, ${solicitadoPor}, ${conversacionId}, ${tareaId}) returning *`;
  await registrar(solicitadoPor, 'aprobacion.solicitar', 'aprobacion', a.id, { tipo, titulo });
  return a;
}

export async function decidirAprobacion(id, decision, por, nota = '') {
  if (!['aprobada', 'rechazada'].includes(decision)) throw new Error('Decisión inválida');
  const [a] = await db()`update ops.aprobaciones set estado = ${decision}, decidido_por = ${por}, decidido_en = now(), nota_decision = ${recortar(nota, 1000)}
    where id = ${id} and estado = 'pendiente' returning *`;
  if (a) await registrar(por, `aprobacion.${decision}`, 'aprobacion', id, { tipo: a.tipo, titulo: a.titulo, nota });
  return a || null;
}

export async function aprobacion(id) {
  const [a] = await db()`select * from ops.aprobaciones where id = ${id}`;
  return a || null;
}

export async function listarAprobaciones({ estado = null, limite = 100 } = {}) {
  return db()`select * from ops.aprobaciones where (${estado}::text is null or estado = ${estado}) order by creado desc limit ${limite}`;
}

/* ---------------- reportes ---------------- */

export async function guardarReporte({ agente, tipo, titulo, texto = '', datos = {} }) {
  const [r] = await db()`insert into ops.reportes (agente, tipo, titulo, texto, datos) values (${agente}, ${tipo}, ${recortar(titulo, 200)}, ${limpiarSecretos(texto)}, ${j(limpiarObjeto(datos))}) returning *`;
  return r;
}

export async function listarReportes({ agente = null, limite = 30 } = {}) {
  return db()`select id, agente, tipo, titulo, texto, datos, creado from ops.reportes where (${agente}::text is null or agente = ${agente}) order by creado desc limit ${limite}`;
}

export async function listarErrores(limite = 50) {
  return db()`select * from ops.errores order by creado desc limit ${limite}`;
}

export async function listarBitacora(limite = 100) {
  return db()`select * from ops.bitacora order by creado desc limit ${limite}`;
}

/* ---------------- consultas para los agentes ---------------- */

export async function interesados(dias = 7, limite = 50) {
  return db()`select c.id as conversacion_id, k.nombre, k.nota_interes, k.acepta_seguimiento, k.actualizado, c.ultimo_entrante, c.modo
    from ops.contactos k join ops.conversaciones c on c.contacto_id = k.id
    where k.interesado and k.actualizado > now() - make_interval(days => ${dias}) and k.wa_id not like 'sim-%'
    order by k.actualizado desc limit ${limite}`;
}

export async function resumenPeriodo(dias = 7) {
  const filas = [];
  for (let i = dias - 1; i >= 0; i--) {
    const [f] = await db()`select ((now() at time zone ${ZONA})::date - ${i}::int)::text as fecha`;
    filas.push({ fecha: f.fecha, ...(await resumenDia(f.fecha)) });
  }
  return filas;
}

/* ---------------- tablero ---------------- */

export async function resumenDia(fecha = null) {
  const sql = db();
  const dia = fecha ? sql`${fecha}::date` : sql`(now() at time zone ${ZONA})::date`;
  const enDia = (col) => sql`(${sql(col)} at time zone ${ZONA})::date = ${dia}`;
  // las conversaciones del simulador del panel (wa_id "sim-…") no cuentan en las métricas
  const real = sql`conversacion_id not in (select c.id from ops.conversaciones c join ops.contactos k on k.id = c.contacto_id where k.wa_id like 'sim-%')`;
  const [r] = await sql`select
    (select count(distinct conversacion_id)::int from ops.mensajes where direccion = 'entrante' and ${enDia('creado')} and ${real}) as conversaciones,
    (select count(*)::int from ops.mensajes where direccion = 'entrante' and ${enDia('creado')} and ${real}) as mensajes_recibidos,
    (select count(*)::int from ops.mensajes where autor = 'asistente' and ${enDia('creado')} and ${real}) as respuestas_asistente,
    (select count(*)::int from ops.mensajes where autor in ('humano_app', 'humano_panel') and ${enDia('creado')} and ${real}) as respuestas_humanas,
    (select count(*)::int from ops.contactos where interesado and wa_id not like 'sim-%' and ${enDia('actualizado')}) as interesados,
    (select count(*)::int from ops.cotizaciones where ${enDia('creado')} and (conversacion_id is null or ${real})) as cotizaciones,
    (select coalesce(sum(total), 0)::float from ops.cotizaciones where ${enDia('creado')} and (conversacion_id is null or ${real})) as monto_cotizado,
    (select count(*)::int from ops.errores where ${enDia('creado')}) as errores,
    (select count(*)::int from ops.tareas where estado = 'completada' and terminada is not null and ${enDia('terminada')}) as tareas_completadas,
    (select count(*)::int from ops.tareas where estado in ('pendiente', 'en_proceso')) as tareas_pendientes,
    (select count(*)::int from ops.aprobaciones where estado = 'pendiente') as aprobaciones_pendientes,
    (select count(*)::int from ops.conversaciones c join ops.contactos k on k.id = c.contacto_id where c.modo = 'humano' and k.wa_id not like 'sim-%') as conversaciones_humano,
    (select coalesce(sum(costo_usd), 0)::float from ops.uso_ia where ${enDia('creado')}) as costo_ia_usd`;
  return r;
}
