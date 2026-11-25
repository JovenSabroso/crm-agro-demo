import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, nuevaFinca, escenarioCampo, D } from './helpers.js';
import { config } from '../src/config/env.js';
import { interpretar, validarSalida } from '../src/integrations/ai/ai.service.js';
import { proponer, confirmar, rechazar } from '../src/integrations/ai/confirmation.service.js';
import { notificar } from '../src/integrations/whatsapp/messaging.service.js';
import { herramientas } from '../src/integrations/ai/tools.js';
import { db } from '../src/db/index.js';

describe('Integraciones futuras (WhatsApp / IA): arquitectura lista y DESACTIVADA', () => {
  it('ninguna integración está habilitada por configuración', () => {
    expect(config.integrations.whatsapp.enabled).toBe(false);
    expect(config.integrations.ai.enabled).toBe(false);
  });
  it('el webhook de WhatsApp responde 503 INTEGRATION_DISABLED (GET y POST) y no guarda contenido', async () => {
    const get = await request(app).get('/api/integraciones/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=123');
    expect(get.status).toBe(503); expect(get.body.error.code).toBe('INTEGRATION_DISABLED');
    const before = db.prepare('SELECT COUNT(*) c FROM integracion_eventos').get().c;
    const post = await request(app).post('/api/integraciones/whatsapp/webhook').send({ entry: [{ changes: [{ value: { messages: [{ text: { body: 'hola' } }] } }] }] });
    expect(post.status).toBe(503);
    expect(db.prepare('SELECT COUNT(*) c FROM integracion_eventos').get().c).toBe(before);
  });
  it('/integraciones/estado informa "pendiente_de_integracion" y exige permiso de administración', async () => {
    const f = await nuevaFinca();
    const r = (await f.get('/integraciones/estado')).body.data;
    expect(r.whatsapp.estado).toBe('pendiente_de_integracion'); expect(r.ia.habilitada).toBe(false); expect(r.despliegue.estado).toBe('pendiente');
    expect((await request(app).get('/api/integraciones/estado')).status).toBe(401);
  });
  it('notificar() NO envía nada: devuelve enviado:false y registra el intento', async () => {
    const r = await notificar(null, { para: '+59170000000', texto: 'Alerta de stock' });
    expect(r).toEqual({ enviado: false, motivo: 'integracion_desactivada' });
    expect(db.prepare("SELECT estado FROM integracion_eventos WHERE estado='desactivado'").get()).toBeTruthy();
  });
  it('la IA desactivada no responde ni propone nada (sin respuestas falsas)', async () => {
    const f = await nuevaFinca();
    const r = await interpretar({ fincaId: f.fincaId, texto: 'Hoy cosechamos 40 kg de tomate del lote 2' });
    expect(r).toEqual({ disponible: false, motivo: 'integracion_desactivada' });
    expect(db.prepare('SELECT COUNT(*) c FROM acciones_pendientes WHERE finca_id=?').get(f.fincaId).c).toBe(0);
  });
  it('sin confirmación NO se guarda nada: proponer() solo crea una acción pendiente; confirmar() ejecuta con validaciones', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    const accion = proponer({ fincaId: f.fincaId, origen: 'ia:test', tipo: 'cosecha', payload: { tipo: 'cosecha', lote: lote.codigo, cantidad: 40, unidad: 'kg' } });
    expect((await f.get('/cosechas')).body.data).toHaveLength(0);                       // todavía NADA guardado
    expect((await f.get('/integraciones/acciones-pendientes')).body.data[0]).toMatchObject({ id: accion.id, estado: 'pendiente' });
    const r = await f.post(`/integraciones/acciones-pendientes/${accion.id}/confirmar`);
    expect(r.status).toBe(200);
    const cos = (await f.get('/cosechas')).body.data;
    expect(cos).toHaveLength(1); expect(cos[0].cantidad).toBe(40); expect(cos[0].comercializable).toBe(0);     // no se libera automáticamente
    expect((await f.post(`/integraciones/acciones-pendientes/${accion.id}/confirmar`)).status).toBe(422);       // no se ejecuta dos veces
  });
  it('rechazar una propuesta no guarda nada; las acciones de otra finca no son accesibles', async () => {
    const a = await nuevaFinca(); const b = await nuevaFinca(); const { lote } = await escenarioCampo(a);
    const acc = proponer({ fincaId: a.fincaId, origen: 'ia:test', tipo: 'cosecha', payload: { tipo: 'cosecha', lote: lote.codigo, cantidad: 5, unidad: 'kg' } });
    expect((await b.post(`/integraciones/acciones-pendientes/${acc.id}/confirmar`)).status).toBe(404);
    expect(rechazar(acc.id, a.fincaId)).toEqual({ rechazada: true });
    await expect(confirmar(acc.id, a.fincaId)).rejects.toThrow(/rechazada/);
    expect((await a.get('/cosechas')).body.data).toHaveLength(0);
  });
  it('validarSalida rechaza JSON inválido, esquemas con campos extra, dosis y creación sin confirmación', () => {
    const ok = { intencion: { tipo: 'cosecha', lote: '2', cantidad: 40, unidad: 'kg' }, respuesta: 'Entendido: cosecha de 40 kg en el lote 2.', requiereConfirmacion: true };
    expect(validarSalida(JSON.stringify(ok)).intencion.cantidad).toBe(40);
    expect(() => validarSalida('no es json')).toThrow();
    expect(() => validarSalida(JSON.stringify({ ...ok, extra: 1 }))).toThrow();
    expect(() => validarSalida(JSON.stringify({ ...ok, requiereConfirmacion: false }))).toThrow(/confirmaci/);
    expect(() => validarSalida(JSON.stringify({ intencion: null, respuesta: 'Aplica 3 ml/L del fungicida', requiereConfirmacion: false }))).toThrow(/dosis/);
    expect(() => validarSalida(JSON.stringify({ intencion: null, respuesta: 'Usa 2 kg por hectárea', requiereConfirmacion: false }))).toThrow(/dosis/);
    expect(() => validarSalida(JSON.stringify({ intencion: { tipo: 'cosecha', lote: '2', cantidad: -4, unidad: 'kg' }, respuesta: 'x', requiereConfirmacion: true }))).toThrow();
  });
  it('herramientas de consulta (solo lectura) devuelven datos reales y no sugieren dosis', async () => {
    const f = await nuevaFinca(); const { lote } = await escenarioCampo(f);
    await f.post('/aplicaciones', { lote_id: lote.id, producto_nombre: 'Prod', motivo: 'm', fecha_aplicacion: D(-1), periodo_carencia_dias: 3, dosis_registrada: 'según etiqueta' });
    expect(herramientas.contextoFinca(f.fincaId).lotes[0].codigo).toBe('L1');
    const ap = herramientas.consultarAplicaciones(f.fincaId)[0];
    expect(ap).toMatchObject({ producto_nombre: 'Prod', dosis_registrada: 'según etiqueta' });
  });
});
