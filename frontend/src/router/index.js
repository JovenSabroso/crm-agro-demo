import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from '../stores/auth.js';

/** Menú lateral (también define permisos y módulo requeridos por cada sección). */
export const MENU = [
  { name: 'dashboard', path: '/', icon: 'LayoutDashboard', label: 'Dashboard', title: 'Dashboard', component: () => import('../views/DashboardView.vue') },
  { name: 'nucleo', path: '/nucleo', icon: 'Building2', label: 'Núcleo y fincas', title: 'Núcleo y fincas', module: 'M0', perm: 'lotes:read', component: () => import('../views/NucleoView.vue') },
  { name: 'lotes', path: '/lotes', icon: 'Sprout', label: 'Lotes y cultivos', title: 'Lotes y cultivos', module: 'M0', perm: 'lotes:read', component: () => import('../views/LotesView.vue') },
  { name: 'campo', path: '/campo', icon: 'Tractor', label: 'Control de campo', title: 'Control de campo', module: 'M1', perm: 'campo:read', component: () => import('../views/CampoView.vue') },
  { name: 'trazabilidad', path: '/trazabilidad/:codigo?', icon: 'QrCode', label: 'Trazabilidad', title: 'Trazabilidad', module: 'M2', perm: 'trazabilidad:read', component: () => import('../views/TrazabilidadView.vue'), menuPath: '/trazabilidad' },
  { name: 'trabajadores', path: '/trabajadores', icon: 'Users', label: 'Trabajadores', title: 'Trabajadores', module: 'M3', perm: 'trabajadores:read', component: () => import('../views/TrabajadoresView.vue') },
  { name: 'inventarios', path: '/inventarios', icon: 'Boxes', label: 'Inventarios', title: 'Inventarios', module: 'M4', perm: 'inventario:read', component: () => import('../views/InventarioView.vue') },
  { name: 'ventas', path: '/ventas', icon: 'ShoppingCart', label: 'Ventas y clientes', title: 'Ventas y clientes', module: 'M5', perm: 'ventas:read', component: () => import('../views/VentasView.vue') },
  { name: 'vivero', path: '/vivero', icon: 'Flower2', label: 'Vivero', title: 'Vivero', module: 'M6', perm: 'vivero:read', component: () => import('../views/ViveroView.vue') },
  { name: 'finanzas', path: '/finanzas', icon: 'ChartNoAxesCombined', label: 'Finanzas y reportes', title: 'Finanzas y reportes', module: 'M7', perm: 'finanzas:read', component: () => import('../views/FinanzasView.vue') },
  { name: 'configuracion', path: '/configuracion', icon: 'Settings', label: 'Configuración', title: 'Configuración', component: () => import('../views/ConfigView.vue') },
];

export const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true, title: 'Iniciar sesión' } },
  { path: '/registro', name: 'registro', component: () => import('../views/LoginView.vue'), meta: { public: true, title: 'Registrar finca' }, props: { modo: 'registro' } },
  { path: '/recuperar', name: 'recuperar', component: () => import('../views/LoginView.vue'), meta: { public: true, title: 'Recuperar contraseña' }, props: { modo: 'recuperar' } },
  { path: '/t/:codigo', name: 'publica', component: () => import('../views/PublicTraceView.vue'), meta: { public: true, title: 'Trazabilidad del producto', bare: true } },
  { path: '/', component: () => import('../components/AppShell.vue'), children: MENU.map(m => ({ path: m.path.replace(/^\//, ''), name: m.name, component: m.component, meta: { perm: m.perm, module: m.module, title: m.title }, props: true })) },
  { path: '/:pathMatch(.*)*', name: 'no-encontrada', component: () => import('../views/NotFoundView.vue'), meta: { public: true, title: 'No encontrada' } },
];

export function createAppRouter(history = createWebHistory(), routeList = routes) {
  const router = createRouter({ history, routes: routeList, scrollBehavior: () => ({ top: 0 }) });
  router.beforeEach(async (to) => {
    const auth = useAuth();
    if (!auth.ready) await auth.loadMe();
    document.title = `${to.meta.title ? to.meta.title + ' · ' : ''}CRM-Agro`;
    if (to.meta.public) return (auth.isAuthenticated && ['login', 'registro'].includes(to.name)) ? { name: 'dashboard' } : true;
    if (!auth.isAuthenticated) return { name: 'login', query: { redirect: to.fullPath } };
    // Guardas de permiso y de módulo (el backend repite ambas validaciones)
    if (to.meta.module && !auth.hasModule(to.meta.module)) return { name: 'dashboard', query: { sin: 'modulo' } };
    if (to.meta.perm && !auth.can(to.meta.perm)) return { name: 'dashboard', query: { sin: 'permiso' } };
    return true;
  });
  return router;
}
