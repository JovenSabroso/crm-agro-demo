export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const monthStart = (d = today()) => d.slice(0, 8) + '01';

export function fmtNum(v, dec = 2) {
  if (v === null || v === undefined || v === '') return '—';
  return new Intl.NumberFormat('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: dec }).format(Number(v));
}
export function fmtMoney(v, moneda = 'Bs') {
  if (v === null || v === undefined || v === '') return '—';
  return `${moneda === 'BOB' ? 'Bs' : moneda} ${new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${Number(day)} ${MESES[Number(m) - 1]} ${y}`;
}
export function fmtMonth(ym) { const [y, m] = ym.split('-'); return `${MESES[Number(m) - 1]} ${y.slice(2)}`; }
export const pct = (v) => (v === null || v === undefined ? '—' : `${fmtNum(v, 1)}%`);
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || '?';
export const labelize = (s = '') => String(s).replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase());

/** Clase de badge según valor de estado */
export function badgeFor(v) {
  const ok = ['activo', 'completada', 'aplicada', 'confirmada', 'pagada', 'presente', 'disponible', 'confirmado', 'convertido', 'cosechado', 'activa'];
  const warn = ['pendiente', 'en_curso', 'parcial', 'retraso', 'borrador', 'en_proceso', 'descanso', 'planificada', 'suspendido'];
  const danger = ['ausente', 'anulada', 'cancelada', 'cancelado', 'inactivo', 'agotada', 'vencida'];
  v = String(v);
  return ok.includes(v) ? 'ok' : warn.includes(v) ? 'warn' : danger.includes(v) ? 'danger' : '';
}
export const CATEGORIAS_PRODUCTO = [
  { value: 'semillas', label: 'Semillas' }, { value: 'fertilizantes', label: 'Fertilizantes' }, { value: 'agroquimicos', label: 'Agroquímicos' },
  { value: 'herramientas', label: 'Herramientas' }, { value: 'materiales', label: 'Materiales agrícolas' }, { value: 'productos_cosechados', label: 'Productos cosechados' }, { value: 'plantines', label: 'Plantines' },
];
export const METODOS_PAGO = [{ value: 'efectivo', label: 'Efectivo' }, { value: 'transferencia', label: 'Transferencia' }, { value: 'qr', label: 'QR / billetera' }, { value: 'tarjeta', label: 'Tarjeta' }, { value: 'credito', label: 'Crédito (por cobrar)' }];
export const ESTADOS_TAREA = [{ value: 'pendiente', label: 'Pendiente' }, { value: 'en_curso', label: 'En curso' }, { value: 'completada', label: 'Completada' }, { value: 'cancelada', label: 'Cancelada' }];
