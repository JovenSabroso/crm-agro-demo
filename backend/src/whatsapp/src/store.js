// Generado: 25/11/2026 06:00
// Estado persistente en un archivo JSON (conversaciones, bajas y pausas). Escritura atómica.
// Para más volumen usa SQLite (node:sqlite en Node 22+) o PostgreSQL; la interfaz es la misma.
import fs from 'node:fs';
import path from 'node:path';

export class StateStore {
  constructor(file) {
    this.file = file;
    this.data = { conversaciones: {}, bajas: [], pausas: {}, habilitado: true };
    this.timer = null;
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      /* primer arranque: archivo inexistente */
    }
  }

  get habilitado() { return this.data.habilitado !== false; }
  setHabilitado(v) { this.data.habilitado = Boolean(v); this.#guardar(); }

  conversacion(phone) { return this.data.conversaciones[phone] ?? null; }
  guardarConversacion(phone, conv) { this.data.conversaciones[phone] = conv; this.#guardar(); }

  estaDeBaja(phone) { return this.data.bajas.includes(phone); }
  darDeBaja(phone) { if (!this.estaDeBaja(phone)) { this.data.bajas.push(phone); this.#guardar(); } }
  reactivar(phone) { this.data.bajas = this.data.bajas.filter((p) => p !== phone); this.#guardar(); }

  pausar(phone, horas, ahora = Date.now()) { this.data.pausas[phone] = ahora + horas * 3_600_000; this.#guardar(); }
  reanudar(phone) { delete this.data.pausas[phone]; this.#guardar(); }
  estaPausado(phone, ahora = Date.now()) {
    const hasta = this.data.pausas[phone];
    if (!hasta) return false;
    if (hasta <= ahora) { delete this.data.pausas[phone]; return false; }
    return true;
  }

  /** Agrupa varias escrituras seguidas en una sola (200 ms) y escribe a un temporal antes de renombrar. */
  #guardar() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
    this.timer.unref?.();
  }

  flush() {
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
