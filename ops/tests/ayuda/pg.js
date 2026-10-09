// Levanta un Postgres local para las pruebas (una sola vez; se reutiliza entre archivos de prueba).
// Crea los roles "anon" y "authenticated" para imitar a Supabase y aplica las migraciones reales.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, chownSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { usarDb } from '../../lib/db.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PUERTO = +(process.env.PG_PRUEBAS_PUERTO || 54329);
const DIR = process.env.PG_PRUEBAS_DIR || join(tmpdir(), 'denmor-ops-pg');
export const URL_PRUEBAS = `postgres://postgres@127.0.0.1:${PUERTO}/postgres`;

function binario(nombre) {
  const base = '/usr/lib/postgresql';
  if (existsSync(base)) for (const v of readdirSync(base).sort().reverse()) { const p = join(base, v, 'bin', nombre); if (existsSync(p)) return p; }
  return nombre;
}

function comoPostgres(cmd, args) {
  const esRoot = process.getuid && process.getuid() === 0;
  return esRoot ? execFileSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { stdio: 'pipe' }) : execFileSync(cmd, args, { stdio: 'pipe' });
}

async function responde() {
  const s = postgres(URL_PRUEBAS, { max: 1, connect_timeout: 2, onnotice: () => {} });
  try { await s`select 1`; return true; } catch { return false; } finally { await s.end({ timeout: 1 }); }
}

let listo = null;
export function basePruebas({ conservar = false } = {}) {
  listo ||= (async () => {
    if (!(await responde())) {
      if (!existsSync(join(DIR, 'PG_VERSION'))) {
        mkdirSync(DIR, { recursive: true });
        if (process.getuid && process.getuid() === 0) { const uid = +execFileSync('id', ['-u', 'postgres']).toString(); const gid = +execFileSync('id', ['-g', 'postgres']).toString(); chownSync(DIR, uid, gid); }
        comoPostgres(binario('initdb'), ['-D', DIR, '-A', 'trust', '-U', 'postgres', '-E', 'UTF8', '--locale=C.UTF-8']);
      }
      comoPostgres(binario('pg_ctl'), ['-D', DIR, '-l', join(DIR, 'log.txt'), '-o', `-p ${PUERTO} -k ${DIR} -c listen_addresses=127.0.0.1`, '-w', 'start']);
    }
    const sql = postgres(URL_PRUEBAS, { max: 4, onnotice: () => {} });
    if (!conservar) await sql.unsafe('drop schema if exists ops cascade');
    const [{ existe }] = await sql`select exists(select 1 from pg_namespace where nspname = 'ops') as existe`;
    await sql.unsafe(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      end $$;`);
    const dirMig = join(AQUI, '../../supabase/migrations');
    if (!existe) for (const f of readdirSync(dirMig).filter((x) => x.endsWith('.sql')).sort()) await sql.unsafe(readFileSync(join(dirMig, f), 'utf8'));
    process.env.DATABASE_URL = URL_PRUEBAS;
    usarDb(sql);
    return sql;
  })();
  return listo;
}

export async function vaciar(sql) {
  const tablas = await sql`select tablename from pg_tables where schemaname = 'ops'`;
  await sql.unsafe(`truncate ${tablas.map((t) => 'ops.' + t.tablename).join(', ')} restart identity cascade`);
}
