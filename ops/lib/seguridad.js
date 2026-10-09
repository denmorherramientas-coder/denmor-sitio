// Protección de datos: enmascarar claves y teléfonos en bitácoras, reportes y errores.
import { timingSafeEqual, createHash, randomBytes } from 'node:crypto';

// Muestra solo el inicio y el final de una clave: "sk-a…9f"
export function enmascarar(valor) {
  const s = String(valor ?? '');
  if (s.length <= 8) return s ? '••••' : '';
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}

// Teléfono: deja lada y últimos 4 dígitos: 52614•••7887
export function enmascararTelefono(tel) {
  const d = String(tel ?? '').replace(/\D/g, '');
  if (d.length < 8) return d ? '•••' : '';
  return `${d.slice(0, d.length - 7)}•••${d.slice(-4)}`;
}

const PATRONES_SECRETOS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /github_pat_[A-Za-z0-9_]{10,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /postgres(?:ql)?:\/\/[^\s"']+/g,
  /\b[A-Fa-f0-9]{40,}\b/g,
];

// Quita claves de cualquier texto antes de guardarlo o mostrarlo
export function limpiarSecretos(texto) {
  let s = String(texto ?? '');
  for (const re of PATRONES_SECRETOS) s = s.replace(re, (m) => `[oculto ${enmascarar(m)}]`);
  return s;
}

// Aplica limpiarSecretos a todos los textos de un objeto (para la bitácora)
export function limpiarObjeto(obj, prof = 0) {
  if (prof > 6) return '[…]';
  if (typeof obj === 'string') return limpiarSecretos(obj);
  if (Array.isArray(obj)) return obj.slice(0, 200).map((x) => limpiarObjeto(x, prof + 1));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = /(key|token|secret|secreto|password|contrasena|authorization)/i.test(k) && typeof v === 'string' ? enmascarar(v) : limpiarObjeto(v, prof + 1);
    }
    return out;
  }
  return obj;
}

// Comparación de secretos en tiempo constante
export function mismoSecreto(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function idCorto(n = 6) {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return [...randomBytes(n)].map((x) => abc[x % abc.length]).join('');
}

export const recortar = (s, n) => String(s ?? '').slice(0, n);
