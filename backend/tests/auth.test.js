import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, nuevaFinca, contexto } from './helpers.js';
import { config } from '../src/config/env.js';

describe('Autenticación', () => {
  it('registra finca + propietario y devuelve token, permisos y módulos (sin exponer el hash)', async () => {
    const r = await request(app).post('/api/auth/registro').send({ finca: { nombre: 'Finca A' }, nombre: 'Ana', email: 'ana@a.test', password: 'Clave1234' });
    expect(r.status).toBe(201);
    expect(r.body.data.token).toBeTruthy();
    expect(r.body.data.usuario.rol).toBe('propietario');
    expect(r.body.data.modulos).toEqual(expect.arrayContaining(['M0', 'M1', 'M7']));
    expect(JSON.stringify(r.body)).not.toMatch(/password|hash/i);
  });
  it('rechaza contraseñas débiles y emails inválidos con detalle de validación', async () => {
    const r = await request(app).post('/api/auth/registro').send({ finca: { nombre: 'X' }, nombre: 'X', email: 'no-es-email', password: 'abc' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.map(d => d.campo)).toEqual(expect.arrayContaining(['email', 'password']));
  });
  it('no permite registrar dos usuarios con el mismo email', async () => {
    const body = { finca: { nombre: 'F' }, nombre: 'N', email: 'dup@a.test', password: 'Clave1234' };
    expect((await request(app).post('/api/auth/registro').send(body)).status).toBe(201);
    expect((await request(app).post('/api/auth/registro').send(body)).status).toBe(400);
  });
  it('login correcto e incorrecto (mismo mensaje para usuario inexistente y clave errónea)', async () => {
    const f = await nuevaFinca();
    const ok = await request(app).post('/api/auth/login').send({ email: f.email, password: 'Clave1234' });
    expect(ok.status).toBe(200); expect(ok.body.data.token).toBeTruthy();
    const mal = await request(app).post('/api/auth/login').send({ email: f.email, password: 'Incorrecta1' });
    const noExiste = await request(app).post('/api/auth/login').send({ email: 'nadie@x.test', password: 'Clave1234' });
    expect(mal.status).toBe(401); expect(noExiste.status).toBe(401);
    expect(mal.body.error.message).toBe(noExiste.body.error.message);
  });
  it('protege rutas: sin token, token basura, token con firma ajena y token expirado → 401', async () => {
    expect((await request(app).get('/api/lotes')).status).toBe(401);
    expect((await request(app).get('/api/lotes').set('Authorization', 'Bearer basura')).status).toBe(401);
    const f = await nuevaFinca();
    const falso = jwt.sign({ sub: 1, fid: 1, tv: 0 }, 'otra-clave');
    expect((await request(app).get('/api/lotes').set('Authorization', `Bearer ${falso}`)).status).toBe(401);
    const exp = jwt.sign({ sub: 1, fid: f.fincaId, tv: 0 }, config.jwtSecret, { expiresIn: -10 });
    const r = await request(app).get('/api/lotes').set('Authorization', `Bearer ${exp}`);
    expect(r.status).toBe(401); expect(r.body.error.message).toMatch(/expir/i);
  });
  it('rechaza tokens firmados con alg=none', async () => {
    const f = await nuevaFinca();
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: 1, fid: f.fincaId, tv: 0 })).toString('base64url') + '.';
    expect((await request(app).get('/api/lotes').set('Authorization', `Bearer ${none}`)).status).toBe(401);
  });
  it('logout invalida el token en el servidor', async () => {
    const f = await nuevaFinca();
    expect((await f.get('/auth/me')).status).toBe(200);
    expect((await f.post('/auth/logout')).status).toBe(200);
    expect((await f.get('/auth/me')).status).toBe(401);
  });
  it('cambio de contraseña: exige la actual y la nueva funciona', async () => {
    const f = await nuevaFinca();
    expect((await f.post('/auth/cambiar-password', { actual: 'Mala12345', nueva: 'Nueva12345' })).status).toBe(400);
    const ok = await f.post('/auth/cambiar-password', { actual: 'Clave1234', nueva: 'Nueva12345' });
    expect(ok.status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: f.email, password: 'Clave1234' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: f.email, password: 'Nueva12345' })).status).toBe(200);
  });
  it('recuperación local: token de un solo uso', async () => {
    const f = await nuevaFinca();
    const s = await request(app).post('/api/auth/olvide-password').send({ email: f.email });
    expect(s.status).toBe(200);
    const token = s.body.data.token_desarrollo;
    expect(token).toBeTruthy();
    expect((await request(app).post('/api/auth/restablecer-password').send({ token, password: 'Reset12345' })).status).toBe(200);
    expect((await request(app).post('/api/auth/restablecer-password').send({ token, password: 'Otra123456' })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: f.email, password: 'Reset12345' })).status).toBe(200);
  });
  it('olvide-password no revela si el email existe', async () => {
    const r = await request(app).post('/api/auth/olvide-password').send({ email: 'fantasma@x.test' });
    expect(r.status).toBe(200); expect(r.body.data.token_desarrollo).toBeUndefined();
  });
  it('usuario desactivado ya no puede usar su token ni iniciar sesión', async () => {
    const owner = await nuevaFinca();
    const c = await owner.post('/usuarios', { nombre: 'Emp', email: `emp${Date.now()}@t.test`, password: 'Clave1234', rol: 'encargado' });
    const login = await request(app).post('/api/auth/login').send({ email: c.body.data.email, password: 'Clave1234' });
    const emp = contexto(login.body.data.token);
    expect((await emp.get('/lotes')).status).toBe(200);
    await owner.put(`/usuarios/${c.body.data.id}`, { activo: false });
    expect((await emp.get('/lotes')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: c.body.data.email, password: 'Clave1234' })).status).toBe(401);
  });
  it('health y documentación son públicos', async () => {
    expect((await request(app).get('/api/health')).body.data.estado).toBe('ok');
    const spec = await request(app).get('/api/openapi.json');
    expect(spec.body.openapi).toBe('3.0.3');
    expect(Object.keys(spec.body.paths).length).toBeGreaterThan(80);
    expect((await request(app).get('/api/docs/')).status).toBe(200);
  });
  it('cabeceras de seguridad (helmet) presentes y sin x-powered-by', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
  it('CORS: origen no permitido no recibe cabecera Allow-Origin', async () => {
    const mal = await request(app).get('/api/health').set('Origin', 'http://evil.example');
    expect(mal.headers['access-control-allow-origin']).toBeUndefined();
    const bien = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(bien.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
