# Lo que necesito de ti, paso a paso

Regla general: **nunca me mandes contraseñas, llaves ni tokens por chat.** Tú las pegas directamente en Netlify (o en Supabase), y yo trabajo sin verlas. Cuando pida una captura, que **no** se vean llaves ni contraseñas.

Orden recomendado: 0 → 1 → 2 → 3 → 4 → pruebas con el simulador → 5 (WhatsApp real, con tu autorización).

---

## Paso 0 · Autorizaciones (solo responder)

1. **¿Apruebas crear un sitio de Netlify separado para el panel** (por ejemplo `ops.denmorherramientas.com`)? No toca el catálogo.
2. **Modelo de IA del vendedor:** de fábrica uso **Claude Opus 5.5**, el de mejor calidad. Claude Sonnet 5.5 cuesta aproximadamente la mitad. Se cambia en el panel (Agentes) cuando quieras. ¿Empezamos con Opus 5.5 durante la etapa supervisada?
3. **Presupuesto diario de IA:** de fábrica es **US$10 por día**. Al llegar al tope, las conversaciones pasan a una persona. ¿Te parece?
4. ¿Autorizas que integre estos cambios a la rama `Denmor-ai-development`? Llegarían mediante un *pull request* que puedes revisar. **`main` no se toca.**

---

## Paso 1 · Supabase (base de datos e inicio de sesión) · ~15 min

**Por qué:** guarda conversaciones, tareas, aprobaciones y la bitácora, y controla quién entra al panel.

1. Entra a **supabase.com** → **New project**. Nombre: `denmor-ops`. Región: **East US (North Virginia)** o la más cercana. Genera una contraseña fuerte de base de datos y **guárdala en tu gestor de contraseñas**.
2. Ya creado: menú izquierdo **SQL Editor** → **New query**. Pega **todo** el contenido del archivo `ops/supabase/migrations/0001_inicial.sql` → botón **Run**.
   📸 Captura del resultado ("Success").
3. Menú **Authentication → Sign In / Providers**: deja activo **Email** y **desactiva "Allow new users to sign up"**. Así nadie puede crearse cuenta.
4. **Authentication → Users → Add user → Create new user**: tu correo y una contraseña fuerte (marca "Auto confirm user").
5. De nuevo en **SQL Editor**, ejecuta esto con **tu correo**:
   ```sql
   insert into ops.operadores (email, nombre, rol) values ('TU_CORREO@ejemplo.com', 'Tu nombre', 'propietario');
   ```
   Para un empleado, usa el rol `'operador'`: puede atender conversaciones, pero no aprobar ni cambiar agentes.
6. Copia estos tres datos (los pegarás en Netlify en el Paso 3):
   - **Project Settings → Data API → Project URL** → será `SUPABASE_URL`
   - **Project Settings → API Keys → anon / public** → será `SUPABASE_ANON_KEY` (es pública por diseño)
   - Botón **Connect** (arriba) → **Connection string → Transaction pooler** (puerto 6543). Reemplaza `[YOUR-PASSWORD]` por la contraseña del punto 1 → será `DATABASE_URL`

   📸 Captura de la lista de tablas en **Table Editor → schema "ops"** (sin llaves).

---

## Paso 2 · Claude API · ~5 min

1. Entra a **console.anthropic.com** → **Settings → Billing**: agrega forma de pago y un **límite de gasto mensual** (sugerido: US$150 al inicio).
2. **Settings → API Keys → Create Key**. Nombre: `denmor-ops`. Copia la llave (se muestra una sola vez) → será `ANTHROPIC_API_KEY`.

---

## Paso 3 · Netlify: sitio del panel · ~15 min

1. En **app.netlify.com** → **Add new project → Import an existing project → GitHub** → repositorio `denmorherramientas-coder/denmor-sitio`.
2. Configuración:
   - **Branch to deploy:** `Denmor-ai-development` (mientras probamos; luego `main` cuando lo autorices)
   - **Base directory:** `ops`
   - Build command: vacío · **Publish directory:** `ops/public` · Functions directory: `ops/netlify/functions`
3. **Antes de publicar**, en **Environment variables** agrega (con "Contains secret values" marcado en las secretas):

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | del Paso 1.6 (secreta) |
   | `SUPABASE_URL` | del Paso 1.6 |
   | `SUPABASE_ANON_KEY` | del Paso 1.6 |
   | `ANTHROPIC_API_KEY` | del Paso 2 (secreta) |
   | `WEBHOOK_SECRETO` | 40 letras y números al azar, generados con tu gestor de contraseñas (secreta) |
   | `INTERNO_SECRETO` | otros 40 caracteres al azar, distintos (secreta) |
   | `WHATSAPP_ENVIO_HABILITADO` | `no` (así no sale nada a WhatsApp todavía) |

4. **Deploy**. Opcional: **Domain management → Add a domain** → `ops.denmorherramientas.com`.
5. 📸 Captura de **Deploys** con el estado "Published" y de la lista de **Functions** (deben aparecer 8).
6. ⚠️ Las funciones en segundo plano y las programadas pueden requerir el plan **Netlify Pro** (US$19/mes). Si en **Functions** aparece un aviso de plan, mándame la captura.

---

## Paso 4 · Primera entrada y pruebas con el simulador · ~20 min

1. Abre el sitio del panel → entra con tu correo y contraseña de Supabase.
2. **Configuración → Estado de conexiones**: todo debe decir "Listo", salvo 360dialog y "Envío real por WhatsApp". 📸 Captura.
3. **WhatsApp → 🧪 Simulador de cliente**: escribe como si fueras un cliente ("¿tienen rotomartillo M18?", "cotízame 2 baterías 5 Ah", "quiero hablar con un asesor", "me haces descuento?"). Revisa que precios y existencias coincidan con la página. **Nada se envía por WhatsApp.**
4. **Órdenes**: escribe una instrucción ("Revisa el sitio y dime si hay productos sin foto") y mira cómo se reparte en tareas.
5. Mándame tus comentarios del tono y las respuestas; los ajusto.

---

## Paso 5 · WhatsApp real (solo cuando lo autorices) · ~30 min

Lee primero `docs/COEXISTENCIA-360DIALOG.md`, en especial **"Lo que cambia al conectar"**.

1. Confirma la versión de la app WhatsApp Business (≥ 2.24.17). 📸 Captura de "Info. de la app".
2. Sigue el procedimiento de **coexistencia** del documento (eligiendo "Conectar tu app WhatsApp Business existente").
3. En 360dialog genera la llave API → pégala en Netlify como `D360_API_KEY` (secreta).
4. En Netlify agrega `WHATSAPP_NUMEROS_PRUEBA` = tu celular **personal** con lada (ej. `5216141234567`) y cambia `WHATSAPP_ENVIO_HABILITADO` a `si` → **Deploys → Trigger deploy**.
5. Panel → **Configuración → Conectar en 360dialog** (escribe CONECTAR).
6. Desde tu celular personal escríbele al 614 192 7887. Debe contestar el asistente. Responde tú desde la app WhatsApp Business y verifica que **el asistente se calla** en esa conversación. 📸 Capturas.
7. Cuando estés conforme, borra `WHATSAPP_NUMEROS_PRUEBA` → **Trigger deploy**. Desde ese momento atiende a todos los clientes.

Para detener todo en cualquier momento: botón **Pausar todos los agentes**, o en Netlify cambia `WHATSAPP_ENVIO_HABILITADO` a `no`.
