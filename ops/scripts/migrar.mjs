// Aplica las migraciones SQL a la base de datos de DATABASE_URL (Supabase).
// Uso (solo si la variable ya existe en tu entorno; nunca la escribas en un chat):  npm run migrar
// Alternativa sin terminal: copia supabase/migrations/0001_inicial.sql en Supabase → SQL Editor → Run.
import { readdirSync, readFileSync } from 'node:fs';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Falta DATABASE_URL.'); process.exit(1); }
const sql = postgres(url, { prepare: false, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : 'require', onnotice: () => {} });
const dir = new URL('../supabase/migrations/', import.meta.url);
try {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await sql.unsafe(readFileSync(new URL(f, dir), 'utf8'));
    console.log('Aplicada:', f);
  }
  const t = await sql`select tablename, rowsecurity from pg_tables where schemaname = 'ops' order by 1`;
  console.log(`Esquema ops: ${t.length} tablas, RLS activo en ${t.filter((x) => x.rowsecurity).length}.`);
} finally {
  await sql.end();
}
