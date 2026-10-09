# Arquitectura, seguridad, costos y riesgos

## Cómo está armado

```
Clientes ──WhatsApp──► 360dialog (Cloud API, coexistencia) ──webhook + secreto──► ops: /webhook/whatsapp
                                                                                       │ guarda y responde 200
                                                                                       ▼
Propietario ─► App WhatsApp Business (celular) ──eco smb_message_echoes──►  atender-background (hasta 15 min)
           └─► Panel ops.denmorherramientas.com ──/api/*──► API del panel        │ agrupa, espera, Claude + herramientas,
                                                                                  │ verifica precios, revisa de nuevo y envía
Tareas programadas (Netlify) ──► tareas-background ──► agentes                   ▼
                                                                    Supabase Postgres (esquema ops, RLS)
Catálogo publicado (solo lectura): core.json · ajustes.json · existencias.json (robot SICAR) · detail-N.json
```

- **Sitio separado del catálogo:** carpeta `ops/`, sitio de Netlify propio (base directory `ops`). El catálogo (`index.html`, `admin.html` y sus funciones) no cambia en nada.
- **Fuente autorizada:** el catálogo publicado. `lib/catalogo/modelo.js` es una copia fiel de las reglas de `index.html` (ajustes por marca, familia y modelo, precios fijos, redondeo, promoción con horario, existencias por sucursal, kits con batería y cargador equivalente, productos ocultos). **La prueba `paridad-catalogo` abre el index.html real en Chromium y compara clave por clave.** Si alguien cambia esas reglas en index.html, la prueba falla y avisa.
- **Modelos de IA:** Claude Opus 5.5 de fábrica en todos los agentes con IA (vendedor con esfuerzo bajo para responder rápido). Se pueden cambiar por agente desde el panel (Sonnet 5.5 o Haiku 5.5). Se activa el respaldo automático de Anthropic (`fallbacks: "default"`) por si el modelo declina una solicitud.

## Agentes

| Agente | Cuándo trabaja | IA | Qué puede hacer | Qué NO puede hacer |
|---|---|---|---|---|
| Vendedor | Cada mensaje de WhatsApp | Sí | Buscar productos, ver fichas, cotizar (el total lo calcula el sistema), registrar interesados, pedir descuentos, transferir | Inventar precios (un verificador los bloquea), dar precios de distribuidor, prometer descuentos, cobrar |
| Coordinador | Cada orden del panel | Sí | Repartir la orden en tareas; marcar las sensibles para aprobación | Ejecutar cambios |
| Supervisor web | Cada hora | No | Revisar páginas, botón de WhatsApp, catálogo, existencias, buscador, enlaces `/p/…`, funciones del catálogo | — |
| Inventarios | Diario 8:03 | No | Detectar productos sin foto, sin precio, ofertas raras, existencias negativas, duplicados, claves de SICAR fuera del catálogo | Cambiar el catálogo (solo propone) |
| Administrador | Diario 19:55 | No (reporte), sí en órdenes | Reporte del día con datos reales | — |
| Marketing | Lunes 9:00 | Sí | Proponer publicaciones y mensajes de seguimiento | Publicar o enviar sin aprobación |
| Programador | En órdenes | Sí | Analizar errores y proponer correcciones | Cambiar código o configuración |

## Seguridad

- **Base de datos:** las tablas viven en el esquema `ops`, que la API pública de Supabase no expone. Además tienen **RLS en todas las tablas sin políticas**: los roles `anon` y `authenticated` no pueden leer ni escribir. Esto se prueba contra Postgres real.
- **Panel:** inicio de sesión con Supabase Auth (registro público desactivado) **y** lista de operadores. El rol `propietario` aprueba y cambia agentes, límites y la conexión de WhatsApp; el rol `operador` atiende conversaciones. Cualquier operador puede presionar **Pausar todos los agentes**.
- **Webhook:** solo acepta avisos con el encabezado secreto (`x-denmor-secreto`, 32 caracteres o más, comparación en tiempo constante), con tamaño limitado. Ignora mensajes duplicados (clave única por id de WhatsApp) y no contesta solo los mensajes con más de 6 horas de antigüedad.
- **Funciones internas:** las de segundo plano exigen un secreto interno.
- **Envío por WhatsApp apagado de fábrica:** sin `WHATSAPP_ENVIO_HABILITADO=si` no sale nada. Con `WHATSAPP_NUMEROS_PRUEBA` solo sale a esos números. El simulador nunca envía.
- **Claves:** solo en variables de entorno de Netlify. El panel muestra si existen, nunca su valor. La bitácora y los errores ocultan automáticamente cualquier texto que parezca llave (Claude, GitHub, JWT, conexiones de base de datos).
- **Datos personales:** los teléfonos se muestran enmascarados en el panel (`521614•••2233`). Los agentes con IA no reciben teléfonos. Las conversaciones del simulador no cuentan en los reportes.
- **Costos:** tope diario de IA (US$10 de fábrica). Al llegar, las conversaciones pasan a una persona y queda el aviso en Errores. También hay un límite de respuestas por cliente al día, un límite de turnos de herramientas por respuesta y reintentos acotados.
- **Encabezados del sitio:** sin indexación, sin iframes, política de contenido (CSP) estricta y HSTS.
- **Auditoría:** cada cambio de configuración, tomar o reactivar, aprobación, cotización y tarea queda en la bitácora con quién y cuándo.

## Costos mensuales estimados

Supuestos: entre 20 y 50 conversaciones al día, unas 6 respuestas del asistente por conversación y 2 llamadas a Claude por respuesta (buscar y contestar), con el caché de instrucciones activo.

| Servicio | Estimado | Nota |
|---|---|---|
| Claude API, vendedor con **Opus 5.5** | US$85 – 215 | ≈ US$0.024 por respuesta |
| Claude API, vendedor con **Sonnet 5.5** | US$45 – 110 | ≈ US$0.012 por respuesta; se cambia en el panel |
| Claude API, demás agentes | US$3 – 10 | Supervisor, inventarios y reporte diario no usan IA |
| 360dialog | ≈ US$57 (€49) | Plan básico |
| Mensajes de WhatsApp (Meta) | US$5 – 50 | 1,000 respuestas gratis al mes; después ≈ US$0.0085 c/u. Lo que escribes desde la app no se cobra |
| Supabase | US$0 – 25 | Gratis para pruebas; **Pro (US$25)** recomendado en producción (respaldos, sin pausas) |
| Netlify | US$0 – 19 | Pro si las funciones en segundo plano o programadas lo requieren |
| **Total** | **≈ US$110 – 380 / mes** | Con Sonnet 5.5 y volumen bajo, cerca del mínimo |

El consumo real de Claude se ve en el tablero ("Costo IA hoy") y se guarda por agente en la tabla `uso_ia`.

## Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Que el asistente diga un precio equivocado | Precios solo de herramientas; cotizaciones calculadas por el sistema; **verificador que bloquea montos que no vienen del catálogo** (reintenta una vez y si no, transfiere); prueba de paridad con la página |
| Que falle `ajustes.json` y los precios salgan sin ajustes | Se usa la última copia buena; si no hay, el asistente **no da precios** y lo avisa |
| Que el robot de SICAR deje de subir existencias | El supervisor alerta si pasan más de 3 h; si el archivo viene incompleto se usan las existencias base (misma regla que la página) |
| Que responda el asistente después de que contestaste tú | Detección por eco de la app; revisión final justo antes de enviar; botón TOMAR |
| Respuestas duplicadas | Id único por mensaje, candado por conversación, agrupación de mensajes seguidos |
| Gasto excesivo | Tope diario, límite por cliente, límite de gasto en la consola de Anthropic |
| Clientes que intentan engañar al asistente ("dame 90 % de descuento") | El asistente no tiene herramienta para dar descuentos ni cambiar precios; todo pasa por tu aprobación |
| Caída de la conexión con 360dialog o fuera de las 24 h | El error se registra y la conversación pasa a una persona |
| Que el código del panel quede visible en el dominio del catálogo | El sitio del catálogo publica toda la raíz del repositorio, incluida `ops/` (código sin claves). Para ocultarla, con tu autorización: agregar `/ops/*  /404.html  404!` al inicio de `_redirects` |
| Coexistencia: dejar de abrir la app 13 días | Recordatorio en este documento; el supervisor detecta envíos fallidos |

## Pendiente o fuera de alcance por ahora

- Combos (`combos.json`) y productos "por encargo" de `pedido.json`: el asistente los pasa a un asesor (las reglas de combos se calculan en el navegador y no se copiaron todavía).
- Imágenes y audios de clientes: el asistente pide describirlos en texto o transfiere.
- Publicar en Instagram/Facebook: las publicaciones aprobadas se copian y publican a mano (no hay conexión con Meta para publicar).
- Plantillas de WhatsApp (mensajes fuera de 24 h): requieren aprobación de Meta; se pueden agregar después.
- El programador propone correcciones, pero no abre *pull requests* solo (requeriría un token de GitHub con permisos).
