// @vitest-environment node
// Integración frontend↔backend: el cliente HTTP REAL del frontend contra la API REAL (Express + SQLite en memoria).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

process.env.NODE_ENV = 'test'; process.env.DB_PATH = ':memory:';
let server, base;
beforeAll(async () => {
  const { createApp } = await import('../../backend/src/app.js');
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  const { configureHttp } = await import('../src/api/http.js'); configureHttp({ baseUrl: base });
  setActivePinia(createPinia());
});
afterAll(() => server?.close());

describe('Integración frontend-backend (flujo completo con el cliente real)', () => {
  it('registro → lote → cultivo → labor → cosecha → QR → inventario → venta → finanzas', async () => {
    const { api } = await import('../src/api/http.js'); const { useAuth } = await import('../src/stores/auth.js');
    const auth = useAuth();
    await auth.registro({ finca: { nombre: 'Finca Integración' }, nombre: 'Test', email: 'int@test.test', password: 'Clave1234' });
    expect(auth.isAuthenticated).toBe(true); expect(auth.can('finanzas:read')).toBe(true); expect(auth.hasModule('M7')).toBe(true);
    const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

    const lote = await api.post('/lotes', { codigo: 'L1', nombre: 'Lote 1' });
    const cultivo = await api.post('/cultivos', { nombre: 'Tomate', tipo: 'hortaliza', unidad_cosecha: 'kg' });
    await api.post('/plantaciones', { lote_id: lote.id, cultivo_id: cultivo.id, fecha_siembra: d(-60) });
    await api.post('/labores', { lote_id: lote.id, tipo: 'Riego manual', fecha_programada: d(-10), estado: 'completada' });
    const cos = await api.post('/cosechas', { lote_id: lote.id, fecha: d(-1), cantidad: 50, comercializable: true, ingresar_inventario: true });
    expect(cos.codigo_lote_cosecha).toMatch(/^LC-/);
    const qr = await api.get(`/trazabilidad/lotes/${cos.codigo_lote_cosecha}/qr`); expect(qr.dataUrl).toMatch(/^data:image\/png/);
    const publica = await api.publicGet(`/public/trazabilidad/${cos.codigo_lote_cosecha}`); expect(publica.cultivo.nombre).toBe('Tomate');
    const prod = (await api.get('/productos', { categoria: 'productos_cosechados' }))[0];
    const cli = await api.post('/clientes', { nombre: 'Cliente' });
    const v = await api.post('/ventas', { cliente_id: cli.id, items: [{ producto_id: prod.id, cantidad: 20, precio_unitario: 10 }] });
    expect(v.total).toBe(200);
    expect((await api.get(`/productos/${prod.id}`)).stock_actual).toBe(30);
    expect((await api.get('/finanzas/resumen')).resumen.ingresos.ventas).toBe(200);
    // listados paginados con meta
    const lista = await api.list('/ventas', { page: 1, pageSize: 5 }); expect(lista.meta.total).toBe(1);
    // errores normalizados
    await expect(api.post('/lotes', { codigo: '', nombre: '' })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    await expect(api.post('/ventas', { cliente_id: cli.id, items: [{ producto_id: prod.id, cantidad: 9999, precio_unitario: 1 }] })).rejects.toMatchObject({ status: 422 });
    // logout invalida el token
    const token = auth.token; await auth.logout();
    const { configureHttp } = await import('../src/api/http.js'); configureHttp({ getToken: () => token, onUnauthorized: () => {} });
    await expect(api.get('/lotes')).rejects.toMatchObject({ status: 401 });
  });
});
