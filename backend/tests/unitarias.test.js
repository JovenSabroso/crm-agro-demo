import { describe, it, expect } from 'vitest';
import { round2, round3, addDays, pad } from '../src/core/utils.js';
import { str, date, num, password, email, optStr } from '../src/core/schemas.js';
import { PERMISOS, ROLES, MODULOS } from '../src/db/catalog.js';

describe('Utilidades y esquemas (unitarias)', () => {
  it('round2/round3 evitan errores de coma flotante', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3); expect(round2(1.005)).toBe(1.01); expect(round3(2.0004)).toBe(2); expect(round2(33.33 * 0.7)).toBe(23.33);
  });
  it('addDays maneja fin de mes, años bisiestos y retrocesos', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01'); expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); expect(addDays('2026-03-01', -1)).toBe('2026-02-28'); expect(pad(7, 4)).toBe('0007');
  });
  it('str elimina HTML y caracteres de control, recorta y valida longitud', () => {
    expect(str().parse('  <img src=x onerror=alert(1)>Hola<script>x</script>  ')).toBe('Holax');
    expect(() => str(5).parse('demasiado largo')).toThrow(); expect(() => str().parse('   ')).toThrow();
    expect(optStr().parse('')).toBe(null); expect(optStr().parse(undefined)).toBeUndefined();
  });
  it('date, num, password y email validan', () => {
    expect(date().safeParse('2026-02-30').success).toBe(false); expect(date().safeParse('2026-02-28').success).toBe(true); expect(date().safeParse('28/02/2026').success).toBe(false);
    expect(num({ gt: 0 }).safeParse('0').success).toBe(false); expect(num().parse('12.5')).toBe(12.5); expect(num().safeParse('abc').success).toBe(false); expect(num().safeParse(Infinity).success).toBe(false);
    expect(password().safeParse('corta1').success).toBe(false); expect(password().safeParse('soloLetrasLargas').success).toBe(false); expect(password().safeParse('Valida123').success).toBe(true);
    expect(email().parse('  USER@Mail.COM ')).toBe('user@mail.com');
  });
  it('catálogo: el trabajador tiene estrictamente menos permisos que el encargado y éste que el propietario', () => {
    const p = ROLES.propietario.permisos, e = ROLES.encargado.permisos, t = ROLES.trabajador.permisos;
    expect(p).toHaveLength(Object.keys(PERMISOS).length);
    expect(t.every(x => e.includes(x))).toBe(true); expect(e.every(x => p.includes(x))).toBe(true);
    expect(t.length).toBeLessThan(e.length); expect(e.length).toBeLessThan(p.length);
    for (const crit of ['usuarios:admin', 'finanzas:read', 'pagos:write', 'modulos:admin']) { expect(t).not.toContain(crit); expect(e).not.toContain(crit); }
    expect(MODULOS.map(m => m.codigo)).toEqual(['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']);
  });
});
