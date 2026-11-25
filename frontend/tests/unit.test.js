import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { fmtMoney, fmtDate, fmtNum, badgeFor, addDays } from '../src/utils/format.js';
import { useAuth } from '../src/stores/auth.js';
import { useUi } from '../src/stores/ui.js';
import { createAppRouter, MENU, routes } from '../src/router/index.js';
const Stub = { template: '<div />' };
const stub = (rs) => rs.map(r => ({ ...r, component: Stub, children: r.children && stub(r.children) }));
const newRouter = () => createAppRouter(createMemoryHistory(), stub(routes));
import { ApiError } from '../src/api/http.js';

describe('formato', () => {
  it('formatea dinero, fechas y números', () => {
    expect(fmtMoney(1234.5, 'BOB')).toMatch(/^Bs 1\.?234,50$/); expect(fmtDate('2026-11-05')).toBe('5 nov 2026'); expect(fmtNum(null)).toBe('—');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01'); expect(badgeFor('anulada')).toBe('danger'); expect(badgeFor('pagada')).toBe('ok');
  });
  it('ApiError expone errores por campo', () => {
    const e = new ApiError(400, 'x', 'VALIDATION_ERROR', [{ campo: 'email', mensaje: 'Email inválido' }]);
    expect(e.fieldErrors).toEqual({ email: 'Email inválido' });
  });
});

describe('sesión, permisos y guardas de ruta (frontend)', () => {
  beforeEach(() => setActivePinia(createPinia()));
  const sesion = (auth, rol, permisos, modulos) => auth.setSession({ token: 't', usuario: { id: 1, nombre: 'U', rol }, finca: { id: 1, nombre: 'F', moneda: 'BOB' }, permisos, modulos });

  it('can() y hasModule() reflejan los permisos del rol', () => {
    const a = useAuth(); sesion(a, 'trabajador', ['campo:read'], ['M0', 'M1']);
    expect(a.can('campo:read')).toBe(true); expect(a.can('finanzas:read')).toBe(false); expect(a.hasModule('M7')).toBe(false); expect(a.isAuthenticated).toBe(true);
    a.clear(); expect(a.isAuthenticated).toBe(false);
  });
  it('el router bloquea sin sesión, sin permiso y con módulo desactivado', async () => {
    const auth = useAuth(); auth.ready = true;
    const router = newRouter();
    await router.push('/finanzas'); expect(router.currentRoute.value.name).toBe('login');
    sesion(auth, 'trabajador', ['lotes:read', 'campo:read'], ['M0', 'M1']);
    await router.push('/finanzas'); expect(router.currentRoute.value.name).toBe('dashboard'); expect(router.currentRoute.value.query.sin).toBeTruthy();
    await router.push('/campo'); expect(router.currentRoute.value.name).toBe('campo');
    sesion(auth, 'propietario', ['campo:read', 'ventas:read'], ['M0', 'M1']);      // M5 desactivado
    await router.push('/ventas'); expect(router.currentRoute.value.query.sin).toBe('modulo');
  });
  it('la ficha pública es accesible sin sesión', async () => {
    const auth = useAuth(); auth.ready = true;
    const router = newRouter();
    await router.push('/t/LC-20260101-ABC123'); expect(router.currentRoute.value.name).toBe('publica');
  });
  it('el menú contiene las 11 secciones requeridas', () => { expect(MENU.map(m => m.label)).toEqual(['Dashboard', 'Núcleo y fincas', 'Lotes y cultivos', 'Control de campo', 'Trazabilidad', 'Trabajadores', 'Inventarios', 'Ventas y clientes', 'Vivero', 'Finanzas y reportes', 'Configuración']); });
  it('toasts y confirmaciones del store de UI', async () => {
    const ui = useUi(); ui.success('ok'); expect(ui.toasts).toHaveLength(1);
    const p = ui.confirm({ title: 'x' }); ui.answer(true); expect(await p).toBe(true);
  });
});
