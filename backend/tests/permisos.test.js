import { describe, it, expect } from 'vitest';
import { nuevaFinca, usuarioConRol, escenarioCampo } from './helpers.js';

describe('Roles, permisos y módulos', () => {
  it('el trabajador no tiene los permisos del propietario (backend)', async () => {
    const owner = await nuevaFinca(); const trab = await usuarioConRol(owner, 'trabajador');
    expect((await trab.get('/lotes')).status).toBe(200);               // lectura permitida
    expect((await trab.post('/lotes', { codigo: 'X', nombre: 'X' })).status).toBe(403);
    expect((await trab.get('/usuarios')).status).toBe(403);
    expect((await trab.get('/finanzas/resumen')).status).toBe(403);
    expect((await trab.post('/ventas', {})).status).toBe(403);
    expect((await trab.put('/finca', { nombre: 'Hack' })).status).toBe(403);
    expect((await trab.put('/modulos/M5', { activo: false })).status).toBe(403);
    expect((await trab.get('/auditoria')).status).toBe(403);
    expect((await trab.post('/pagos', {})).status).toBe(403);
  });
  it('el trabajador sí puede registrar labores y riegos de campo', async () => {
    const owner = await nuevaFinca(); const trab = await usuarioConRol(owner, 'trabajador'); const { lote } = await escenarioCampo(owner);
    expect((await trab.post('/riegos', { lote_id: lote.id, fecha: new Date().toISOString().slice(0, 10) })).status).toBe(201);
  });
  it('el encargado opera pero no administra usuarios, módulos ni finanzas', async () => {
    const owner = await nuevaFinca(); const enc = await usuarioConRol(owner, 'encargado');
    expect((await enc.post('/lotes', { codigo: 'E1', nombre: 'Lote enc' })).status).toBe(201);
    expect((await enc.post('/clientes', { nombre: 'Cliente' })).status).toBe(201);
    expect((await enc.get('/usuarios')).status).toBe(403);
    expect((await enc.get('/finanzas/resumen')).status).toBe(403);
    expect((await enc.post('/jornales', {})).status).toBe(403);
    expect((await enc.put('/modulos/M6', { activo: false })).status).toBe(403);
  });
  it('el propietario administra todo', async () => {
    const owner = await nuevaFinca();
    expect((await owner.get('/usuarios')).status).toBe(200);
    expect((await owner.get('/finanzas/resumen')).status).toBe(200);
    expect((await owner.get('/auditoria')).status).toBe(200);
    expect((await owner.put('/finca', { nombre: 'Nuevo nombre' })).body.data.nombre).toBe('Nuevo nombre');
  });
  it('/auth/me expone solo los permisos del rol', async () => {
    const owner = await nuevaFinca(); const trab = await usuarioConRol(owner, 'trabajador');
    const p = (await trab.get('/auth/me')).body.data.permisos;
    expect(p).toContain('campo:write'); expect(p).not.toContain('finanzas:read'); expect(p).not.toContain('usuarios:admin');
  });
  it('un módulo desactivado bloquea sus endpoints y el M0 no puede desactivarse', async () => {
    const owner = await nuevaFinca();
    expect((await owner.get('/viveros')).status).toBe(200);
    expect((await owner.put('/modulos/M6', { activo: false })).status).toBe(200);
    const r = await owner.get('/viveros');
    expect(r.status).toBe(403); expect(r.body.error.message).toMatch(/M6/);
    expect((await owner.put('/modulos/M0', { activo: false })).status).toBe(422);
    expect((await owner.put('/modulos/M6', { activo: true })).status).toBe(200);
    expect((await owner.get('/viveros')).status).toBe(200);
    const lista = (await owner.get('/modulos')).body.data;
    expect(lista.find(m => m.codigo === 'M0').activo).toBe(1);
  });
  it('aislamiento entre fincas: no se puede leer ni modificar datos de otra finca', async () => {
    const a = await nuevaFinca('A'); const b = await nuevaFinca('B');
    const lote = (await a.post('/lotes', { codigo: 'A1', nombre: 'Lote A' })).body.data;
    expect((await b.get(`/lotes/${lote.id}`)).status).toBe(404);
    expect((await b.put(`/lotes/${lote.id}`, { nombre: 'Robado' })).status).toBe(404);
    expect((await b.del(`/lotes/${lote.id}`)).status).toBe(404);
    expect((await b.get('/lotes')).body.data).toHaveLength(0);
    // referenciar un lote ajeno desde un registro propio también se rechaza
    const r = await b.post('/riegos', { lote_id: lote.id, fecha: '2026-01-01' });
    expect(r.status).toBe(400);
  });
  it('no se puede degradar o desactivar al último propietario', async () => {
    const owner = await nuevaFinca();
    const me = (await owner.get('/auth/me')).body.data.usuario;
    expect((await owner.put(`/usuarios/${me.id}`, { rol: 'encargado' })).status).toBe(422);
    expect((await owner.put(`/usuarios/${me.id}`, { activo: false })).status).toBe(422);
  });
  it('registra auditoría de operaciones críticas', async () => {
    const owner = await nuevaFinca();
    await owner.post('/lotes', { codigo: 'AU1', nombre: 'Aud' });
    const a = (await owner.get('/auditoria')).body.data;
    expect(a.some(x => x.accion === 'crear' && x.entidad === 'lotes')).toBe(true);
  });
});
