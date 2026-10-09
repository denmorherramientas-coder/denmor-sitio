// Conexión a la base de datos (Postgres de Supabase, a través del pooler en modo transacción).
import postgres from 'postgres';

let sql = null;

export function db() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta la variable DATABASE_URL (conexión a Supabase).');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  sql = postgres(url, {
    prepare: false, // obligatorio con el pooler de Supabase en modo transacción
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: local ? false : 'require',
    onnotice: () => {},
  });
  return sql;
}

// Para pruebas y el servidor local
export function usarDb(conexion) {
  sql = conexion;
}

export async function cerrarDb() {
  if (sql) await sql.end({ timeout: 5 });
  sql = null;
}
