-- DENMOR AI OPERATIONS · esquema inicial
--
-- Todas las tablas viven en el esquema "ops" (no en "public"), así la API automática de Supabase
-- (PostgREST) no las expone. Además tienen Row Level Security activado SIN políticas: los roles
-- "anon" y "authenticated" no pueden leer ni escribir nada. Solo el servidor (funciones de Netlify),
-- conectado con el usuario de la base de datos, tiene acceso.

create schema if not exists ops;
revoke all on schema ops from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema ops from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema ops from authenticated'; end if;
end $$;

create extension if not exists pgcrypto;

-- Configuración editable desde el panel (horarios, tiempos, textos, límites, permisos)
create table if not exists ops.configuracion (
  clave text primary key,
  valor jsonb not null,
  actualizado timestamptz not null default now(),
  actualizado_por text
);

-- Personas que pueden entrar al panel (además de iniciar sesión en Supabase Auth)
create table if not exists ops.operadores (
  email text primary key check (email = lower(email)),
  nombre text,
  rol text not null default 'operador' check (rol in ('propietario', 'operador')),
  activo boolean not null default true,
  creado timestamptz not null default now()
);

create table if not exists ops.contactos (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null unique,
  nombre text,
  interesado boolean not null default false,
  nota_interes text,
  acepta_seguimiento boolean not null default false,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

-- Una conversación por contacto (el hilo de WhatsApp)
create table if not exists ops.conversaciones (
  id uuid primary key default gen_random_uuid(),
  contacto_id uuid not null unique references ops.contactos(id) on delete cascade,
  modo text not null default 'asistente' check (modo in ('asistente', 'humano')),
  motivo_modo text,
  modo_desde timestamptz not null default now(),
  ultimo_entrante timestamptz,
  ultimo_saliente timestamptz,
  ultimo_humano timestamptz,
  respondido_hasta timestamptz,
  procesando_hasta timestamptz,
  respuestas_hoy integer not null default 0,
  respuestas_dia date,
  creado timestamptz not null default now()
);
create index if not exists conversaciones_ultimo_entrante on ops.conversaciones (ultimo_entrante desc);

create table if not exists ops.mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references ops.conversaciones(id) on delete cascade,
  direccion text not null check (direccion in ('entrante', 'saliente')),
  autor text not null check (autor in ('cliente', 'asistente', 'humano_app', 'humano_panel', 'sistema')),
  tipo text not null default 'text',
  texto text,
  wa_message_id text unique,
  estado_entrega text,
  error text,
  meta jsonb not null default '{}'::jsonb,
  creado timestamptz not null default now()
);
create index if not exists mensajes_conversacion on ops.mensajes (conversacion_id, creado);

create table if not exists ops.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique,
  conversacion_id uuid references ops.conversaciones(id) on delete set null,
  contacto_id uuid references ops.contactos(id) on delete set null,
  partidas jsonb not null,
  total numeric(12, 2) not null,
  entrega text not null default 'tienda' check (entrega in ('tienda', 'envio')),
  estado text not null default 'enviada' check (estado in ('borrador', 'enviada', 'aceptada', 'vencida', 'cancelada')),
  vigencia date not null,
  creado_por text not null,
  creado timestamptz not null default now()
);

-- Órdenes del propietario en lenguaje natural
create table if not exists ops.ordenes (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  creado_por text not null,
  estado text not null default 'recibida' check (estado in ('recibida', 'interpretada', 'error')),
  interpretacion jsonb,
  creado timestamptz not null default now()
);

create table if not exists ops.tareas (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid references ops.ordenes(id) on delete set null,
  agente text not null check (agente in ('coordinador', 'vendedor', 'supervisor', 'inventarios', 'administrador', 'marketing', 'programador')),
  trabajo text not null default 'libre' check (trabajo in ('libre', 'interpretar_orden', 'revision_sitio', 'revision_inventario', 'reporte_diario', 'propuestas_marketing', 'enviar_seguimiento')),
  entrada jsonb not null default '{}'::jsonb,
  titulo text not null,
  descripcion text,
  prioridad text not null default 'normal' check (prioridad in ('baja', 'normal', 'alta', 'urgente')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso', 'esperando_aprobacion', 'completada', 'fallida', 'cancelada')),
  origen text not null default 'propietario' check (origen in ('propietario', 'programada', 'agente')),
  resultado text,
  resultado_datos jsonb,
  intentos integer not null default 0,
  creado_por text,
  creado timestamptz not null default now(),
  iniciada timestamptz,
  terminada timestamptz
);
create index if not exists tareas_estado on ops.tareas (estado, prioridad, creado);

create table if not exists ops.aprobaciones (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('descuento', 'publicacion', 'mensaje_masivo', 'cambio_precio', 'operacion_financiera', 'cambio_importante', 'otro')),
  titulo text not null,
  detalle jsonb not null default '{}'::jsonb,
  solicitado_por text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'vencida')),
  conversacion_id uuid references ops.conversaciones(id) on delete set null,
  tarea_id uuid references ops.tareas(id) on delete set null,
  decidido_por text,
  decidido_en timestamptz,
  nota_decision text,
  creado timestamptz not null default now()
);
create index if not exists aprobaciones_estado on ops.aprobaciones (estado, creado desc);

-- Bitácora de auditoría: quién hizo qué y cuándo (agentes y personas)
create table if not exists ops.bitacora (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  actor text not null,
  accion text not null,
  entidad text,
  entidad_id text,
  detalle jsonb not null default '{}'::jsonb
);
create index if not exists bitacora_creado on ops.bitacora (creado desc);

-- Consumo de Claude API (control de costos)
create table if not exists ops.uso_ia (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  agente text not null,
  modelo text not null,
  tokens_entrada integer not null default 0,
  tokens_salida integer not null default 0,
  tokens_cache_lectura integer not null default 0,
  tokens_cache_escritura integer not null default 0,
  costo_usd numeric(12, 6) not null default 0,
  conversacion_id uuid,
  tarea_id uuid
);
create index if not exists uso_ia_creado on ops.uso_ia (creado desc);

create table if not exists ops.errores (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  origen text not null,
  mensaje text not null,
  detalle jsonb not null default '{}'::jsonb,
  resuelto boolean not null default false
);
create index if not exists errores_creado on ops.errores (creado desc);

create table if not exists ops.reportes (
  id uuid primary key default gen_random_uuid(),
  agente text not null,
  tipo text not null,
  titulo text not null,
  texto text,
  datos jsonb not null default '{}'::jsonb,
  creado timestamptz not null default now()
);
create index if not exists reportes_creado on ops.reportes (agente, creado desc);

-- Row Level Security en todas las tablas, sin políticas (nadie fuera del servidor tiene acceso).
-- No se usa FORCE: el dueño de las tablas (el usuario con el que se conecta el servidor) conserva el acceso.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'ops' loop
    execute format('alter table ops.%I enable row level security', t);
    execute format('revoke all on ops.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on ops.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on ops.%I from authenticated', t); end if;
  end loop;
end $$;
