// Servidor local de DENMOR AI OPERATIONS: corre las mismas funciones de Netlify con un Postgres local,
// el catálogo de prueba y (si no hay ANTHROPIC_API_KEY) un Claude de demostración.
//   npm run dev            → http://localhost:8890  (botón "Entrar en modo local")
// Nunca envía a WhatsApp: WHATSAPP_ENVIO_HABILITADO se fuerza a "no".
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { basePruebas } from '../tests/ayuda/pg.js';
import { claudeDemo } from '../tests/ayuda/claude-demo.js';
import * as F from '../tests/fixtures/catalogo.js';
import * as repo from '../lib/repo.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

export async function iniciarServidorLocal({ puerto = +(process.env.PUERTO || 8890), conservar = true, catalogoReal = !!process.env.CATALOGO_REAL } = {}) {
  process.env.WHATSAPP_ENVIO_HABILITADO = 'no';
  process.env.INTERNO_SECRETO = randomBytes(24).toString('hex');
  process.env.WEBHOOK_SECRETO ||= 'secreto-local-de-pruebas-0123456789abcdef';
  await basePruebas({ conservar });
  const base = `http://localhost:${puerto}`;
  process.env.URL = base;

  if (!catalogoReal) await repo.guardarConfig('catalogo', { core: `${base}/prueba/core.json`, ajustes: `${base}/prueba/ajustes.json`, existencias: `${base}/prueba/existencias.json`, detalle: `${base}/prueba/detail-{b}.json`, sitio: 'https://denmorherramientas.com', cache_minutos: 1 }, 'servidor-local');
  await repo.guardarConfig('horario', { fuera_de_horario: 'atender' }, 'servidor-local');

  globalThis.__denmorAuthLocal = (t) => (t === 'local-pruebas-denmor-ops' ? { email: 'propietario@local', nombre: 'Propietario (local)', rol: 'propietario' } : null);
  if (!process.env.ANTHROPIC_API_KEY) globalThis.__denmorClaude = claudeDemo();

  const fn = async (nombre) => (await import(`../netlify/functions/${nombre}.mjs`)).default;
  // las funciones "background" se ejecutan en este mismo proceso, sin esperar
  globalThis.__denmorDisparar = async (nombre, cuerpo) => {
    const h = await fn(nombre);
    setImmediate(() => h(new Request(`${base}/.netlify/functions/${nombre}`, { method: 'POST', headers: { 'x-interno': process.env.INTERNO_SECRETO, 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })).catch((e) => console.error(nombre, e)));
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, base);
      const p = url.pathname;
      if (p.startsWith('/prueba/')) {
        const datos = { '/prueba/core.json': F.core(), '/prueba/ajustes.json': F.ajustes({ promo: false }), '/prueba/existencias.json': F.existencias(), '/prueba/detail-0.json': { '2904-20-AA': { c: 'Rotomartillo de 1/2" con motor sin carbones.' } } }[p];
        res.writeHead(datos ? 200 : 404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(datos || {}));
      }
      let handler = null;
      if (p.startsWith('/api/')) handler = await fn('api');
      else if (p === '/webhook/whatsapp') handler = await fn('whatsapp-webhook');
      if (handler) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
        const r = await handler(new Request(url, { method: req.method, headers: req.headers, body }));
        res.writeHead(r.status, Object.fromEntries(r.headers));
        return res.end(Buffer.from(await r.arrayBuffer()));
      }
      const archivo = join(RAIZ, 'public', p === '/' ? 'index.html' : p.replace(/\.\.+/g, ''));
      const data = await readFile(archivo);
      res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch (e) {
      res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(e.code === 'ENOENT' ? 'No encontrado' : 'Error: ' + e.message);
    }
  });
  await new Promise((r) => server.listen(puerto, '127.0.0.1', r));
  return { server, base, cerrar: () => new Promise((r) => server.close(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { base } = await iniciarServidorLocal();
  console.log(`DENMOR AI OPERATIONS local en ${base}  (Claude: ${process.env.ANTHROPIC_API_KEY ? 'real' : 'demostración'}, WhatsApp: simulado)`);
}
