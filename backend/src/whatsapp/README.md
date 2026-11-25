# Bot de WhatsApp + Gemini (todo en Node.js)

Un solo proceso: Baileys (WhatsApp) + agrupador de mensajes + bot por estados + Gemini (opcional).
Se puede usar solo (`npm start`) o **pegar en un backend Express existente** como módulo (`src/index.js`).
- Despliegue, dominio y VPS: `../GUIA_WHATSAPP_GEMINI_NODEJS.txt`
- Integrarlo al backend y frontend de otro proyecto: `../INTEGRACION_WHATSAPP_AL_BACKEND_Y_FRONTEND.txt`

## Inicio rápido

```bash
npm install            # necesita git (Baileys 6.x baja una dependencia de GitHub)
npm test               # 28 pruebas, sin red ni WhatsApp
cp .env.example .env   # completar ADMIN_TOKEN (y GEMINI_API_KEY si quieres IA)
npm start              # aparece un QR: escanéalo con un número de PRUEBA
```

## Usarlo dentro de otro backend Express

```js
import { crearModuloWhatsApp, loadConfig } from './whatsapp/src/index.js';
const wa = crearModuloWhatsApp({
  config: loadConfig(), logger,
  autenticar: miMiddlewareDeAdmin,                       // opcional: su propio login
  negocio: async () => ({ /* datos desde la base de datos */ }),
  hooks: { alCrearPedido: async ({ phone, texto }) => { /* guardar en la BD */ } },
});
app.use('/api/whatsapp', wa.router);                     // API REST + /panel
app.listen(PORT, () => wa.iniciar());
```

API REST y panel de administración (`/api/whatsapp/panel`) listos para cualquier frontend;
`panel/whatsapp-client.js` es un cliente JS sin dependencias (React, Vue, etc.).

## Cómo adaptarlo

1. `datos/negocio.json`: nombre, horario, dirección, catálogo y preguntas frecuentes.
2. `src/intents.js`: intenciones y palabras clave.
3. `src/engine.js`: respuestas y estados (el flujo de pedido es un ejemplo).

## Reglas de diseño

- La IA **solo clasifica** (etiqueta de una lista cerrada) o, en `MODO_IA=responder`, contesta usando **solo** el contexto del negocio.
- Precios y horarios salen siempre de tus datos, nunca de la IA.
- Sin clave de Gemini o con Gemini caído, el bot sigue funcionando por palabras clave y menú.
- Los registros no guardan el texto de los mensajes y los números van enmascarados.
- El servicio escucha solo en `127.0.0.1`; se publica con nginx + HTTPS.

Baileys no es la API oficial de WhatsApp: puede romperse y la cuenta puede ser restringida. Usa un número de prueba.
