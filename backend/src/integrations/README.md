# Integraciones futuras (DESACTIVADAS en esta fase)

No se conecta ningun proveedor externo. Existe la arquitectura lista:

## WhatsApp (whatsapp/)
- provider.interface.js: contrato MessagingProvider + esquemas InboundMessage / OutboundMessage.
- adapters.js: WhatsAppCloudApiAdapter y TwilioWhatsAppAdapter (stubs con TODO(integracion)).
- messaging.service.js: notificar() (hoy devuelve enviado:false) y registrarEvento() (tabla integracion_eventos).
- webhook.controller.js + ruta /api/integraciones/whatsapp/webhook: responde 503 INTEGRATION_DISABLED.
Para conectar: implementar los metodos del adaptador, completar WHATSAPP_* en .env, poner enabled:true en src/config/env.js
(a proposito NO se lee del .env), exponer el webhook por HTTPS y suscribirlo en Meta/Twilio.

## IA (ai/)
- schemas.js (entrada/salida Zod, sin campo de dosis), prompts.js (reglas obligatorias), tools.js (consultas solo lectura),
  providers.js (adaptadores Anthropic/Groq stub), ai.service.js (interpretar; validarSalida rechaza dosis y registros sin confirmacion),
  confirmation.service.js (cola acciones_pendientes: nada se guarda hasta confirmar).
Para conectar: implementar complete() del adaptador, definir AI_API_KEY, activar enabled y enlazar el webhook de WhatsApp con interpretar().
