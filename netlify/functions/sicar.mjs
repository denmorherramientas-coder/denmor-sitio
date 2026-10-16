// Ventas SICAR de Denmor en vivo, leídas de la ventana de solo lectura que publica MAKMEX
// (esquema `denmor` en su Postgres de Supabase, actualizado cada 2 minutos desde la tienda).
//
// Solo panel (Authorization: Bearer <token de GitHub del panel>, igual que Pedidos y Visitas):
//   GET /api/sicar?dias=90  → { ok, estado, ventas:[[fecha,ticket,clave,cantidad,importe,sucursal,desc]], dias:{…}, pagos:[…] }
//
// Configuración en Netlify (Site configuration → Environment variables). La contraseña NUNCA va en el código:
//   SICAR_PG_PASSWORD  la contraseña que dio Emiliano            (obligatoria)
//   SICAR_PG_HOST      host del session pooler, ej. aws-1-ca-central-1.pooler.supabase.com   (obligatoria)
//   SICAR_PG_USER      opcional; por defecto denmor_lector.iypxvfyniytguotlsukn
//   o bien SICAR_PG_URL con la cadena completa postgresql://…  (sustituye a las tres de arriba)
import pg from 'pg';

const REPO = process.env.DENMOR_REPO || 'denmorherramientas-coder/denmor-ajustes';
const DEF_USER = 'denmor_lector.iypxvfyniytguotlsukn';
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/* ---------- autorización (misma regla que Pedidos) ---------- */
const authCache = new Map();
async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function autorizado(req) {
  const key = process.env.DENMOR_PANEL_KEY;
  if (key && req.headers.get('x-panel-key') === key) return true;
  const m = /^Bearer\s+(\S{20,200})$/.exec(req.headers.get('authorization') || '');
  if (!m) return false;
  const h = await sha(m[1]);
  if ((authCache.get(h) || 0) > Date.now()) return true;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}`, { headers: { authorization: 'Bearer ' + m[1], accept: 'application/vnd.github+json', 'user-agent': 'denmor-panel' } });
    if (!r.ok) return false;
    const j = await r.json();
    if (!(j.permissions && (j.permissions.push || j.permissions.admin))) return false;
    authCache.set(h, Date.now() + 10 * 60 * 1000);
    return true;
  } catch (e) {
    return false;
  }
}

function conexion() {
  const ssl = { rejectUnauthorized: false }; // el pooler de Supabase usa su propia CA; la conexión sí va cifrada
  if (process.env.SICAR_PG_URL) return { connectionString: process.env.SICAR_PG_URL.replace(/[?&]sslmode=[^&]*/, ''), ssl };
  if (!process.env.SICAR_PG_HOST || !process.env.SICAR_PG_PASSWORD) return null;
  return { host: process.env.SICAR_PG_HOST, port: +(process.env.SICAR_PG_PORT || 5432), database: 'postgres', user: process.env.SICAR_PG_USER || DEF_USER, password: process.env.SICAR_PG_PASSWORD, ssl };
}

/* el tablero se abre seguido: guardamos la respuesta 60 s para no pegarle de más a la ventana de MAKMEX */
const cache = new Map();

async function leer(cfg, dias) {
  const c = new pg.Client({ ...cfg, connectionTimeoutMillis: 15000, statement_timeout: 50000, application_name: 'denmor-panel' });
  await c.connect();
  try {
    const desde = `current_date - ${dias}`;
    const [est, ventas, porDia, pagos] = await Promise.all([
      c.query(`select * from denmor.sucursal_estado order by leido_en desc nulls last limit 1`),
      c.query(`select to_char(v.fecha,'YYYY-MM-DD"T"HH24:MI:SS') f, v.ven_id::text t, coalesce(d.clave,'') k, d.cantidad::float8 q, d.importe::float8 i, left(coalesce(d.descripcion,''),80) n
                 from denmor.venta v join denmor.venta_detalle d on d.ven_id = v.ven_id
                where v.status = 1 and coalesce(d.borrado,0) <> 1 and v.fecha >= ${desde}
                order by v.fecha, d.orden`),
      c.query(`select to_char(dia,'YYYY-MM-DD') d, ventas::int v, total::float8 t, piezas::float8 p from denmor.venta_dia where dia >= ${desde} order by dia`),
      c.query(`select to_char(v.fecha,'YYYY-MM-DD') d, coalesce(p.tipo,'Otro') tipo, sum(p.total)::float8 t
                 from denmor.venta v join denmor.venta_pago p on p.ven_id = v.ven_id
                where v.status = 1 and v.fecha >= ${desde} group by 1, 2 order by 1`),
    ]);
    const e = est.rows[0] || null;
    return {
      ok: true,
      estado: e ? { leido_en: e.leido_en, ok: e.ok, error: e.error || '' } : null,
      sucursales: { 2: 'Denmor' },
      cols: ['fecha', 'ticket', 'clave', 'cantidad', 'importe', 'sucursal', 'desc'],
      ventas: ventas.rows.map((r) => [r.f, r.t, r.k, r.q, r.i, '2', r.n]),
      dias: Object.fromEntries(porDia.rows.map((r) => [r.d, { ventas: r.v, total: r.t, piezas: r.p }])),
      pagos: pagos.rows.map((r) => [r.d, r.tipo, r.t]),
    };
  } finally {
    await c.end().catch(() => {});
  }
}

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'método' }, 405);
  if (!(await autorizado(req))) return json({ error: 'sin permiso' }, 401);
  const cfg = conexion();
  if (!cfg) return json({ error: 'sin_config', msg: 'Faltan SICAR_PG_HOST y SICAR_PG_PASSWORD en Netlify' }, 503);
  const dias = Math.min(400, Math.max(1, parseInt(new URL(req.url).searchParams.get('dias') || '90', 10) || 90));
  const hit = cache.get(dias);
  if (hit && hit.t > Date.now() - 60000) return json(hit.j);
  try {
    const j = await leer(cfg, dias);
    cache.set(dias, { t: Date.now(), j });
    return json(j);
  } catch (e) {
    const m = String(e && e.message || e);
    const retirado = /not permitted to log in|permission denied for schema/i.test(m);
    return json({ error: retirado ? 'acceso_retirado' : 'conexion', msg: m.slice(0, 300) }, 502);
  }
};

export const config = { path: '/api/sicar' };
