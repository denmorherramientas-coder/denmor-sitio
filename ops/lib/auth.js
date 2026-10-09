// Autenticación del panel: sesión de Supabase Auth + lista de operadores autorizados (ops.operadores).
import { createHash } from 'node:crypto';
import * as repo from './repo.js';

const cache = new Map(); // sha256(token) → { vence, operador }

export async function operadorDeSolicitud(req, { fetchImpl = fetch } = {}) {
  const m = /^Bearer\s+(\S{20,4096})$/.exec(req.headers.get('authorization') || '');
  if (!m) return null;
  const token = m[1];
  if (globalThis.__denmorAuthLocal) return globalThis.__denmorAuthLocal(token); // solo el servidor local de pruebas lo define
  const h = createHash('sha256').update(token).digest('hex');
  const c = cache.get(h);
  if (c && c.vence > Date.now()) return c.operador;
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  let email = null;
  try {
    const r = await fetchImpl(`${url.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    email = u?.email ? String(u.email).toLowerCase() : null;
  } catch {
    return null;
  }
  if (!email) return null;
  const operador = await repo.operador(email);
  // solo se recuerdan accesos válidos (60 s); un operador desactivado pierde el acceso en máximo 1 minuto
  if (operador) cache.set(h, { vence: Date.now() + 60000, operador });
  if (cache.size > 500) cache.clear();
  return operador;
}
