# CRM-Agro — Gestión modular agrícola, del campo a la nube
UNIFRANZ · Sede El Alto · Ingeniería de Sistemas. Backend Node.js/Express + SQLite; frontend Vue 3 (Vite, Router, Pinia, Chart.js, Leaflet, PWA).

## Requisitos
Node.js >= 20 (probado con 24) y npm.

## Instalación y ejecución local
```powershell
npm run install:all          # instala backend y frontend
npm run reset                # crea la BD SQLite, aplica migraciones y carga DATOS DE DEMOSTRACIÓN (ficticios)
npm run dev:backend          # API en http://localhost:4000  (Swagger: /api/docs)
npm run dev:frontend         # App en http://localhost:5173
```
Un solo proceso: `npm run build` y luego `npm start` → todo en http://localhost:4000.
Variables de entorno: copia `backend/.env.example` a `backend/.env` (opcional en desarrollo; `JWT_SECRET` es obligatorio en producción).
Migraciones: `npm --prefix backend run migrate` (también se aplican al iniciar). Sin demo: no ejecutes `seed` y usa "Registrar una finca" en el login.

## Usuarios de prueba (contraseña `Demo1234`, datos ficticios)
`propietario@crmagro.test` · `encargado@crmagro.test` · `trabajador@crmagro.test`

## Pruebas
`npm test` (backend: Vitest + Supertest; frontend: Vitest, incluye integración con la API real).

## Estructura
- `backend/src/modules/*`: dominios (auth, nucleo, campo, trazabilidad, trabajadores, inventario, ventas, vivero, finanzas, dashboard) con servicios transaccionales.
- `backend/src/core`: router con OpenAPI automático, CRUD genérico, validación Zod, auditoría. `backend/src/db`: migraciones SQL, catálogo, seed.
- `backend/src/integrations`: WhatsApp/IA preparadas y desactivadas (ver su README). `frontend/src`: vistas, componentes, stores, router con guardas.

## Estado
Implementado: M0–M7, QR real, trazabilidad pública, roles/permisos (backend y frontend), PWA, Swagger, pruebas.
Pendiente (por diseño): conexión real de WhatsApp, IA, despliegue (Render/Vercel) y dominio.
Notas: no se usa Prisma (se eligió `better-sqlite3` + migraciones SQL por sus transacciones síncronas); el frontend está en JavaScript.
