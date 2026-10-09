// Arma las dependencias reales (base de datos, WhatsApp, Claude, catálogo) para las funciones de Netlify.
import * as repo from './repo.js';
import * as vendedor from './agentes/vendedor.js';
import { clienteClaude } from './ia/claude.js';
import { clienteWhatsApp } from './whatsapp/d360.js';
import { cargarCatalogo } from './catalogo/index.js';
import { mismoSecreto } from './seguridad.js';

// Si falta la llave de Claude, cualquier intento de usarlo falla con un mensaje claro (y el flujo pasa a humano)
const sinClaude = { beta: { messages: { create: async () => { throw new Error('Falta la variable ANTHROPIC_API_KEY (Claude API).'); } } } };
export const claude = () => globalThis.__denmorClaude || (process.env.ANTHROPIC_API_KEY ? clienteClaude() : sinClaude); // __denmorClaude: solo servidor local

// Las conversaciones del simulador del panel (wa_id "sim-…") nunca se envían a WhatsApp
export function whatsapp() {
  const real = clienteWhatsApp();
  return {
    modo: real.modo,
    enviarTexto: (to, texto) => (String(to).startsWith('sim-') ? Promise.resolve({ id: null, simulado: true, motivo: 'simulador' }) : real.enviarTexto(to, texto)),
    escribiendo: (id) => real.escribiendo(id),
    configurarWebhook: (url, s) => real.configurarWebhook(url, s),
  };
}

export async function catalogo() {
  const cfg = await repo.config();
  return cargarCatalogo(cfg.catalogo);
}

export function depsAtencion(extra = {}) {
  return { repo, wa: whatsapp(), cliente: claude(), vendedor, catalogo, ...extra };
}

/* ---------------- llamadas internas entre funciones ---------------- */

export function urlSitio() {
  return (process.env.URL || process.env.DEPLOY_URL || 'http://localhost:8888').replace(/\/$/, '');
}

// Dispara una función en segundo plano (responde 202 de inmediato; el trabajo sigue hasta 15 min)
export async function disparar(nombre, cuerpo) {
  if (globalThis.__denmorDisparar) return globalThis.__denmorDisparar(nombre, cuerpo); // servidor local
  const r = await fetch(`${urlSitio()}/.netlify/functions/${nombre}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-interno': process.env.INTERNO_SECRETO || '' },
    body: JSON.stringify(cuerpo),
  });
  if (r.status >= 400) throw new Error(`No se pudo iniciar ${nombre}: ${r.status}`);
}

export function esInterno(req) {
  const s = process.env.INTERNO_SECRETO;
  return !!s && s.length >= 32 && mismoSecreto(req.headers.get('x-interno') || '', s);
}

export const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
