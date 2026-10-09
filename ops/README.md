# DENMOR AI OPERATIONS

Empleados digitales de Denmor Herramientas: un vendedor que atiende WhatsApp con el catálogo real, agentes que revisan el sitio y el inventario, reportes diarios y un panel privado para darles órdenes, aprobar y supervisar.

- **Separado del catálogo:** todo vive en `ops/` y se publica como un sitio de Netlify aparte (base directory `ops`). No modifica `index.html`, `admin.html` ni las funciones del catálogo.
- **Documentos:**
  - [Pasos del propietario](docs/PASOS-DEL-PROPIETARIO.md): qué hacer, dónde y qué captura mandar.
  - [WhatsApp + 360dialog (coexistencia)](docs/COEXISTENCIA-360DIALOG.md)
  - [Arquitectura, seguridad, costos y riesgos](docs/ARQUITECTURA-SEGURIDAD-COSTOS.md)

## Estructura

```
ops/
  netlify.toml                 configuración del sitio (encabezados de seguridad, funciones)
  public/                      panel (HTML + JS sin dependencias)
  netlify/functions/
    whatsapp-webhook.mjs       recibe avisos de 360dialog
    atender-background.mjs     prepara y envía la respuesta del vendedor
    tareas-background.mjs      ejecuta tareas de los agentes
    api.mjs                    API del panel (/api/*)
    cron-*.mjs                 tareas programadas (cada hora, 8:03, 19:55, lunes 9:00)
  lib/
    catalogo/                  lectura del catálogo y reglas de precio (copia fiel de index.html)
    agentes/                   vendedor, coordinador, supervisor, inventarios, administrador, trabajador (IA)
    flujo/atender.js           atención de WhatsApp: agrupar, esperar, revisar, enviar, transferir
    whatsapp/d360.js           cliente de 360dialog y lectura de avisos (incluye ecos de la app)
    ia/claude.js               Claude API: bucle de herramientas, consumo, respaldo
    repo.js · db.js            base de datos (Postgres de Supabase, esquema ops)
    api.js · auth.js           panel: rutas, sesión de Supabase y operadores
  supabase/migrations/         esquema y RLS
  tests/                       74 pruebas (Postgres real y Chromium)
  scripts/servidor-local.mjs   panel completo en local con datos de prueba
```

## Desarrollo

Requisitos: Node 22, PostgreSQL 16 (binarios locales) y Chromium para Playwright.

```bash
cd ops
npm install
npm test          # 74 pruebas: base de datos, catálogo (paridad con index.html), flujo de WhatsApp, agentes, API, panel
npm run dev       # http://localhost:8890 → "Entrar en modo local" (Claude de demostración, WhatsApp simulado)
```

Con `ANTHROPIC_API_KEY` en el entorno, `npm run dev` usa Claude real para el simulador. El envío por WhatsApp siempre está apagado en local.

## Variables de entorno (Netlify)

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Supabase · pooler en modo transacción (puerto 6543) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Inicio de sesión del panel |
| `ANTHROPIC_API_KEY` | Claude API |
| `D360_API_KEY` | 360dialog (llave del número) |
| `WEBHOOK_SECRETO` | Encabezado secreto que envía 360dialog (32 caracteres o más) |
| `INTERNO_SECRETO` | Llamadas entre funciones (32 caracteres o más) |
| `WHATSAPP_ENVIO_HABILITADO` | `si` para enviar de verdad (de fábrica: apagado) |
| `WHATSAPP_NUMEROS_PRUEBA` | Opcional: solo se envía a estos números (pruebas controladas) |

## Estado de verificación

| Componente | Verificado | Pendiente de prueba real |
|---|---|---|
| Base de datos, RLS, candados, duplicados | ✅ Postgres 16 local | Aplicar en Supabase |
| Precios y existencias | ✅ Paridad con index.html (Chromium, datos de prueba) | Comparar con el catálogo en vivo (desde aquí no hay acceso a denmorherramientas.com) |
| Vendedor y flujo de WhatsApp | ✅ Con Claude simulado (20 escenarios) | Conversaciones con Claude real (falta `ANTHROPIC_API_KEY`) |
| 360dialog | ✅ Lectura de avisos y envío (simulado) | Conexión real (requiere tu autorización y la llave) |
| Panel | ✅ Chromium de punta a punta, escritorio y celular | Inicio de sesión con Supabase real |
| Tareas programadas | ✅ Lógica y horarios | Ejecución en Netlify |
