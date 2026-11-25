import { describe, it, expect } from 'vitest';
import { nuevaFinca, escenarioCampo, cosechaComercializable, D } from './helpers.js';
import { moverStock } from '../src/modules/inventario.service.js';
import { db } from '../src/db/index.js';

const crearProducto = async (f, extra = {}) => (await f.post('/productos', { categoria: 'fertilizantes', nombre: 'Urea', unidad: 'kg', stock_minimo: 10, ...extra })).body.data;

describe('M4 · Inventarios', () => {
  it('entradas, salidas y ajustes actualizan el stock y el historial', async () => {
    const f = await nuevaFinca(); const p = await crearProducto(f);
    expect((await f.post('/inventario/movimientos', { producto_id: p.id, tipo: 'entrada', cantidad: 100, costo_unitario: 5 })).status).toBe(201);
    expect((await f.post('/inventario/movimientos', { producto_id: p.id, tipo: 'salida', motivo: 'consumo', cantidad: 30 })).status).toBe(201);
    const aj = await f.post('/inventario/movimientos', { producto_id: p.id, tipo: 'ajuste', cantidad_real: 65 });
    expect(aj.body.data.delta).toBe(-5);
    expect((await f.get(`/productos/${p.id}`)).body.data.stock_actual).toBe(65);
    const h = (await f.get(`/inventario/movimientos?producto_id=${p.id}`)).body;
    expect(h.meta.total).toBe(3);
    expect(h.data.map(m => m.stock_resultante).sort((a, b) => a - b)).toEqual([65, 70, 100]);
  });
  it('NO permite existencias negativas y el stock queda intacto', async () => {
    const f = await nuevaFinca(); const p = await crearProducto(f, { stock_inicial: 10 });
    const r = await f.post('/inventario/movimientos', { producto_id: p.id, tipo: 'salida', cantidad: 10.5 });
    expect(r.status).toBe(422); expect(r.body.error.message).toMatch(/insuficiente/i);
    expect((await f.get(`/productos/${p.id}`)).body.data.stock_actual).toBe(10);
    expect((await f.get('/inventario/movimientos')).body.meta.total).toBe(1);        // solo la existencia inicial
  });
  it('la base de datos también impide stock negativo (restricción CHECK)', () => {
    const fid = db.prepare("INSERT INTO fincas (nombre) VALUES ('F')").run().lastInsertRowid;
    const pid = db.prepare("INSERT INTO productos (finca_id, categoria, nombre, stock_actual) VALUES (?, 'semillas', 'S', 1)").run(fid).lastInsertRowid;
    expect(() => db.prepare('UPDATE productos SET stock_actual = -1 WHERE id = ?').run(pid)).toThrow(/CHECK/);
  });
  it('evita movimientos duplicados con clave de idempotencia', async () => {
    const f = await nuevaFinca(); const p = await crearProducto(f);
    const body = { producto_id: p.id, tipo: 'entrada', cantidad: 20, clave_idempotencia: 'compra-123' };
    expect((await f.post('/inventario/movimientos', body)).status).toBe(201);
    const dup = await f.post('/inventario/movimientos', body);
    expect(dup.status).toBe(409);
    expect((await f.get(`/productos/${p.id}`)).body.data.stock_actual).toBe(20);
  });
  it('costo promedio ponderado en entradas; salidas valorizadas al promedio', async () => {
    const f = await nuevaFinca(); const p = await crearProducto(f);
    await f.post('/inventario/movimientos', { producto_id: p.id, tipo: 'entrada', cantidad: 100, costo_unitario: 10 });
    await f.post('/inventario/movimientos', { producto_id: p.id, tipo: 'entrada', cantidad: 100, costo_unitario: 20 });
    const prod = (await f.get(`/productos/${p.id}`)).body.data;
    expect(prod.costo_promedio).toBe(15); expect(prod.valor_stock).toBe(3000);
    const s = (await f.post('/inventario/movimientos', { producto_id: p.id, tipo: 'salida', motivo: 'consumo', cantidad: 10 })).body.data;
    expect(s.costo_unitario).toBe(15);
  });
  it('alerta de stock mínimo y filtro de bajo stock', async () => {
    const f = await nuevaFinca(); const p = await crearProducto(f, { stock_inicial: 50, stock_minimo: 20 });
    expect((await f.get('/inventario/alertas')).body.data).toHaveLength(0);
    await f.post('/inventario/movimientos', { producto_id: p.id, tipo: 'salida', motivo: 'consumo', cantidad: 35 });
    expect((await f.get('/inventario/alertas')).body.data[0].nombre).toBe('Urea');
    expect((await f.get('/productos?bajo_stock=1')).body.meta.total).toBe(1);
    expect((await f.get('/alertas')).body.data.some(a => a.tipo === 'stock_bajo')).toBe(true);
  });
  it('validaciones: cantidad cero/negativa, motivo inválido, producto ajeno', async () => {
    const f = await nuevaFinca(); const p = await crearProducto(f); const otra = await nuevaFinca('Otra');
    expect((await f.post('/inventario/movimientos', { producto_id: p.id, tipo: 'entrada', cantidad: 0 })).status).toBe(400);
    expect((await f.post('/inventario/movimientos', { producto_id: p.id, tipo: 'entrada', cantidad: -3 })).status).toBe(400);
    expect((await f.post('/inventario/movimientos', { producto_id: p.id, tipo: 'entrada', motivo: 'venta', cantidad: 3 })).status).toBe(400);
    expect((await otra.post('/inventario/movimientos', { producto_id: p.id, tipo: 'entrada', cantidad: 3 })).status).toBe(400);
  });
  it('productos cosechados: solo entran desde una cosecha y se controlan por lote de cosecha', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    const cos = await cosechaComercializable(f, lote.id, 100);
    const prodId = (await f.get('/productos?categoria=productos_cosechados')).body.data[0].id;
    expect((await f.post('/inventario/movimientos', { producto_id: prodId, tipo: 'entrada', cantidad: 10 })).status).toBe(422);
    expect((await f.post('/inventario/movimientos', { producto_id: prodId, tipo: 'salida', motivo: 'merma', cantidad: 5 })).status).toBe(422);   // falta lote
    const ok = await f.post('/inventario/movimientos', { producto_id: prodId, tipo: 'salida', motivo: 'merma', cantidad: 5, lote_cosecha_id: cos.lote_cosecha_id });
    expect(ok.status).toBe(201);
    expect((await f.post('/inventario/movimientos', { producto_id: prodId, tipo: 'salida', motivo: 'merma', cantidad: 96, lote_cosecha_id: cos.lote_cosecha_id })).status).toBe(422);
    expect((await f.get(`/productos/${prodId}`)).body.data.stock_actual).toBe(95);
  });
  it('el ingreso de cosecha no puede superar lo cosechado (ingreso parcial permitido)', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    const cos = (await f.post('/cosechas', { lote_id: lote.id, fecha: D(-1), cantidad: 100 })).body.data;
    expect((await f.post(`/cosechas/${cos.id}/inventario`, { cantidad: 150 })).status).toBe(422);
    expect((await f.post(`/cosechas/${cos.id}/inventario`, { cantidad: 60 })).status).toBe(201);
    expect((await f.post(`/cosechas/${cos.id}/inventario`, { cantidad: 41 })).status).toBe(422);
    expect((await f.post(`/cosechas/${cos.id}/inventario`, { cantidad: 40 })).status).toBe(201);
    const prodId = (await f.get('/productos?categoria=productos_cosechados')).body.data[0].id;
    expect((await f.get(`/productos/${prodId}`)).body.data.stock_actual).toBe(100);
    // ya con inventario no se puede eliminar ni editar la cosecha
    expect((await f.del(`/cosechas/${cos.id}`)).status).toBe(409);
    expect((await f.put(`/cosechas/${cos.id}`, { cantidad: 10 })).status).toBe(422);
  });
  it('moverStock es atómico dentro de una transacción mayor: si algo falla, nada se guarda', async () => {
    const f = await nuevaFinca(); const p = await crearProducto(f, { stock_inicial: 10 });
    const fincaId = f.fincaId;
    expect(() => db.transaction(() => {
      moverStock({ fincaId, productoId: p.id, tipo: 'salida', motivo: 'consumo', cantidad: 4 });
      moverStock({ fincaId, productoId: p.id, tipo: 'salida', motivo: 'consumo', cantidad: 40 });   // falla
    })()).toThrow(/insuficiente/i);
    expect((await f.get(`/productos/${p.id}`)).body.data.stock_actual).toBe(10);
  });
  it('productos: búsqueda, filtro por categoría, orden y paginación', async () => {
    const f = await nuevaFinca();
    for (let i = 1; i <= 25; i++) await f.post('/productos', { categoria: i % 2 ? 'semillas' : 'materiales', nombre: `Prod ${String(i).padStart(2, '0')}`, unidad: 'u' });
    const p1 = (await f.get('/productos?pageSize=10&page=1&sort=nombre&dir=asc')).body;
    expect(p1.data).toHaveLength(10); expect(p1.meta).toMatchObject({ total: 25, totalPages: 3 }); expect(p1.data[0].nombre).toBe('Prod 01');
    expect((await f.get('/productos?categoria=semillas')).body.meta.total).toBe(13);
    expect((await f.get('/productos?q=Prod 2')).body.meta.total).toBe(6);
    expect((await f.post('/productos', { categoria: 'semillas', nombre: 'Prod 01', unidad: 'u' })).status).toBe(409);   // duplicado
  });
});
