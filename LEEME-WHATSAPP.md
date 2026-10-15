# Asistente de WhatsApp de Denmor

Contesta a los clientes en el WhatsApp de la tienda (614 192 7887) unos 30 segundos después de su último mensaje,
con precios y existencias reales del catálogo (los mismos de denmorherramientas.com, con ajustes y promoción del panel).

- Si el cliente manda varios mensajes seguidos, espera y contesta todo junto.
- Muestra "escribiendo…" y manda la respuesta en mensajes cortos, como una persona.
- Toma pedidos: aparecen en el panel → Pedidos (folio `DN-AAMMDD-W…`, estado "nuevo").
- Pasa la plática a una persona cuando el cliente lo pide, hay queja/garantía, piden descuento o no sabe algo.
- **Si tú contestas desde la app de WhatsApp Business, el asistente se calla en ese chat** por 12 horas.
- Si le preguntan si es un robot, no lo niega: dice que es el asistente de Denmor y ofrece pasarlos con alguien.

## Archivos

| Archivo | Qué hace |
|---|---|
| `netlify/functions/whatsapp.mjs` | Webhook `/api/whatsapp`: recibe mensajes y lo que contestas desde la app |
| `netlify/functions/whatsapp-responder-background.mjs` | Espera ~30 s, piensa y contesta (función en segundo plano) |
| `netlify/wa/catalogo.mjs` | Lee catálogo, ajustes de precio, promoción y existencias |
| `netlify/wa/cerebro.mjs` | Instrucciones del asistente y conexión con Claude |
| `netlify/wa/chats.mjs` | Memoria de cada plática y registro de pedidos |
| `netlify/wa/whatsapp.mjs` | Envío de mensajes (Meta o 360dialog) |

## Variables en Netlify

Site configuration → Environment variables:

| Variable | Valor |
|---|---|
| `WA_ACTIVO` | `1` para que conteste. Cualquier otro valor = apagado (solo guarda los mensajes). |
| `WA_PRUEBA_NUMEROS` | Para probar: tu número personal, ej. `5216141234567`. Solo a esos contesta. Bórrala para abrirlo a todos. |
| `WA_PROVEEDOR` | `360dialog` (con coexistencia) o `meta` |
| `WA_360_KEY` | La API key de 360dialog (si usas 360dialog) |
| `WA_TOKEN` / `WA_PHONE_ID` / `WA_APP_SECRET` | Solo si usas la API de Meta directa |
| `WA_VERIFY_TOKEN` | Una contraseña larga que tú inventes (protege el webhook) |
| `ANTHROPIC_API_KEY` | Llave de la API de Claude (console.anthropic.com) |
| `WA_AVISO_NUMERO` | Tu número personal para avisos de "cliente necesita atención" (opcional) |
| `WA_ESPERA_SEG` | Segundos de espera antes de contestar. Por defecto `30`. |
| `WA_HUMANO_HORAS` | Horas que se calla en un chat después de que contestas tú. Por defecto `12`. |
| `WA_MODELO` | Modelo de Claude. Por defecto `claude-haiku-5-5` (rápido y económico). |

## Puesta en marcha (coexistencia: sigues usando tu app)

1. Actualiza la app WhatsApp Business del celular de la tienda a la versión más reciente.
2. Abre cuenta con un proveedor autorizado de Meta que permita **coexistencia** (por ejemplo 360dialog) y conecta
   el número 614 192 7887 eligiendo la opción de **seguir usando la app**. Escanea el código QR desde la app cuando lo pida
   y acepta compartir el historial. Tienes 24 horas para terminar la sincronización.
3. En el proveedor, copia tu API key y configura el webhook a `https://denmorherramientas.com/api/whatsapp`.
4. En console.anthropic.com crea una llave de API y cárgale saldo.
5. En Netlify pon las variables de arriba con `WA_ACTIVO=1` y `WA_PRUEBA_NUMEROS` = tu número personal. Redeploy.
6. Escríbele a la tienda desde tu número personal y prueba: pregunta por un modelo, pide apartar, pide hablar con alguien.
7. Cuando te guste cómo contesta, borra `WA_PRUEBA_NUMEROS` y redeploy: ya contesta a todos.

Para apagarlo en cualquier momento: `WA_ACTIVO=0` y redeploy.
