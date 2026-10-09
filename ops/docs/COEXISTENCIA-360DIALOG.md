# WhatsApp Business App + API (coexistencia) con 360dialog

Investigación hecha el 9 de octubre de 2026. **No se ha registrado ni conectado nada.** Este documento prepara la conexión, que solo se hará con tu autorización.

> Nota de verificación: desde el entorno de desarrollo no se pudo abrir docs.360dialog.com directamente (la red lo bloquea). La información viene de búsquedas sobre la documentación oficial de 360dialog y de Meta, y de proveedores que la citan. Antes de conectar, confirma en tu cuenta de 360dialog los puntos marcados con ⚠️.

## Conclusión

**La coexistencia sí está disponible para tu caso.** México fue de los primeros países con coexistencia y no aparece en la lista de países excluidos de 360dialog (Australia, India, Japón, Nigeria, Filipinas, Rusia, Corea del Sur, Sudáfrica, Turquía, UE/EEE y Reino Unido). Con coexistencia:

- Conservas el número **+52 614 192 7887**.
- Sigues usando la **app WhatsApp Business** en tu celular; el historial se conserva.
- El asistente responde por la API, y lo que tú escribas desde la app le llega al sistema como evento `smb_message_echoes`. **Así el asistente sabe que tú respondiste y se calla en esa conversación** (ya está programado y probado).

## Requisitos (revísalos antes de autorizar)

| Requisito | Estado para Denmor |
|---|---|
| App WhatsApp Business **versión 2.24.17 o más reciente** | ⚠️ Revisa en tu celular: Ajustes → Ayuda → Info. de la app |
| Número activo en la app desde hace **al menos 7 días** (una versión de la guía lo pide) | ✅ Lo usas desde hace tiempo |
| Celular con cámara (se escanea un código QR) | ✅ |
| **Meta Business (portafolio comercial)** a nombre de la empresa, con razón social, dirección, sitio web y teléfono | ⚠️ Hay que crearlo o confirmar que existe. **Elígelo bien: no se puede cambiar después** |
| No agregar a personas ajenas a la empresa al portafolio de Meta (Meta puede bloquearlo) | Recomendación |
| Cuenta de 360dialog con plan contratado | ⚠️ Pendiente (pago tuyo) |
| Un webhook que reciba los avisos | ✅ Ya está construido: `https://<sitio-ops>/webhook/whatsapp` |

## Lo que cambia al conectar (lee esto con atención)

1. **Se desvinculan los dispositivos acompañantes.** Al conectar, WhatsApp Web, WhatsApp Desktop y las tabletas vinculadas se desconectan. **Tu celular principal NO se desvincula.** Después puedes volver a vincular los dispositivos compatibles.
   ⚠️ Pediste "no desvincular dispositivos". Esto es parte del procedimiento oficial y no se puede evitar, por eso no conectaré nada sin tu autorización expresa.
2. **Abre la app al menos una vez cada 13 días.** Si no, la conexión se desactiva. **No desinstales la app**, porque eso desconecta la cuenta.
3. Los mensajes enviados desde dispositivos acompañantes no compatibles **no le llegan al sistema**, así que el asistente no se entera de que alguien respondió. Contesta desde el celular o desde el panel.
4. Restricciones conocidas: sin insignia azul (cuenta verificada), sin cambios de foto de perfil después de conectar, sin grupos por la API y sin llamadas por la API. El número no se puede mover a otra cuenta de WhatsApp Business (WABA). Algunos proveedores reportan que en la app se desactivan funciones como listas de difusión, mensajes temporales o editar/eliminar ⚠️ (Meta publica la lista oficial de funciones).
5. **La regla de las 24 horas:** el asistente solo puede escribir libremente dentro de las 24 horas siguientes al último mensaje del cliente. Fuera de ese tiempo se necesitan **plantillas aprobadas por Meta** (de pago). El sistema ya respeta esta regla: el seguimiento automático solo se envía dentro de la ventana.

## Costos

| Concepto | Costo aproximado | Nota |
|---|---|---|
| 360dialog, plan básico | **€49 / mes** (~US$57) por número | Precio publicado en 360dialog.com. Hay planes superiores (Premium €99) con más soporte |
| Mensajes de servicio (respuestas a clientes dentro de 24 h) | **1,000 gratis al mes por número**; después ≈ **US$0.0085 por mensaje** en México | Cambio de Meta vigente desde el 1 de octubre de 2026 ⚠️ (confírmalo en la tabla de precios de Meta) |
| Mensajes que escribes **desde la app** | **Gratis** | Los ecos de la app no se cobran |
| Plantillas de marketing (promociones fuera de 24 h) | ≈ US$0.04 por mensaje en México | Solo con tu aprobación |
| Plantillas de utilidad (avisos de pedido, etc.) | ≈ US$0.0085 por mensaje | |

## Procedimiento de incorporación (cuando lo autorices)

**No lo hagas todavía.** Es la Fase 6 del plan; antes se prueba todo con el simulador.

1. **Meta Business:** entra a business.facebook.com → Configuración del negocio → Información del negocio. Confirma razón social, dirección, sitio (denmorherramientas.com) y teléfono. 📸 Mándame una captura de esa pantalla **sin** números de cuenta.
2. **360dialog:** crea la cuenta en hub.360dialog.com y elige el plan (pago tuyo).
3. En el registro integrado (Embedded Signup) de 360dialog:
   - A "¿El número ya está en la API de WhatsApp Business?" responde **No**.
   - Indica que **está conectado a la app WhatsApp Business**.
   - Elige **"Conectar tu app WhatsApp Business existente"** (*connect your existing WhatsApp Business app*). **No elijas registrar un número nuevo ni "migrar"**: eso te sacaría de la app.
   - Escribe el número, verifica el código y **escanea el QR desde la app** (WhatsApp Business → Ajustes → dispositivos vinculados / opción que muestre 360dialog).
   - Compartir el historial es opcional. Recomendación: **no compartirlo** al inicio. El asistente no lo necesita y así se guardan menos datos personales.
4. En 360dialog genera la **llave API del número** (D360-API-KEY). **No me la mandes por chat:** pégala tú en Netlify como variable `D360_API_KEY` (ver PASOS-DEL-PROPIETARIO.md).
   ⚠️ Si después generas otra llave, 360dialog borra el webhook y hay que volver a conectarlo con el botón del panel.
5. En el panel → Configuración → **"Conectar en 360dialog"** (escribe CONECTAR). Esto registra el webhook con su encabezado secreto.
6. Pruebas controladas: con `WHATSAPP_NUMEROS_PRUEBA` = tu celular personal, el asistente solo responde a ese número. Después, atención supervisada.

## Cómo se detecta que tú respondiste

| Situación | Qué pasa |
|---|---|
| Respondes desde la **app en tu celular** | Llega el evento `smb_message_echoes` → la conversación pasa a "Persona" y el asistente se calla. Si estaba preparando una respuesta, **la descarta** (se revisa justo antes de enviar) |
| Respondes desde el **panel** | La conversación pasa a "Persona" automáticamente |
| Respondes desde un **dispositivo acompañante no compatible** | El sistema no se entera. Usa el botón **TOMAR CONVERSACIÓN** |
| Quieres que el asistente vuelva | Botón **REACTIVAR ASISTENTE** (o reactivación automática tras N horas, si la configuras) |
| Emergencia | **PAUSAR TODOS LOS AGENTES** (botón en la parte superior del panel) |

## Si la coexistencia fallara

Si el registro integrado muestra un error de país o de elegibilidad, **detengo la integración** y quedan estas opciones:

1. Reintentar en unas semanas (Meta amplía la cobertura gradualmente).
2. **Número nuevo solo para el asistente**, y el 614 192 7887 sigue igual en la app. Puedes poner el número del asistente en el catálogo.
3. Seguir solo con el panel y el simulador, sin WhatsApp automático, hasta resolverlo.

## Fuentes

- 360dialog · Coexistence Onboarding: https://docs.360dialog.com/docs/hub/embedded-signup/whatsapp-coexistence/coexistence-onboarding
- 360dialog · WhatsApp Coexistence: https://docs.360dialog.com/docs/hub/embedded-signup/whatsapp-coexistence
- 360dialog · Coexistence (limitaciones, 13 días): https://docs.360dialog.com/docs/resources/phone-numbers/coexistence
- 360dialog · Coexistence Webhooks: https://docs.360dialog.com/docs/waba-basics/phone-numbers/coexistence/coexistence-webhooks
- 360dialog · Envío y recepción de mensajes: https://docs.360dialog.com/docs/guides/send-and-receive-messages
- 360dialog · Recibir mensajes por webhook: https://docs.360dialog.com/partner/messaging/receiving-messages-via-webhook
- 360dialog · Precios: https://360dialog.com/whatsapp-api
- Meta · Incorporar usuarios de la app WhatsApp Business: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/
- Referencia del evento smb_message_echoes (proveedores): https://dualhook.com/docs/webhook-smb-message-echoes · https://developers.telnyx.com/docs/messaging/whatsapp/coexistence/webhooks
- Precios de WhatsApp en México 2026: https://www.aurorainbox.com/en/2026/05/26/price-whatsapp-business-api-mexico-2026/ · https://www.wati.io/en/blog/whatsapp-service-message-pricing/
