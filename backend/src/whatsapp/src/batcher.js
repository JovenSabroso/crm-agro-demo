// Generado: 25/11/2026 06:10
// Agrupa los mensajes seguidos de un mismo número en UN lote: espera `windowMs` sin mensajes nuevos
// (con tope `maxWaitMs`). Así el bot no contesta tres veces a tres mensajes seguidos.

export function createBatcher({ windowMs, maxWaitMs, onBatch, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout, now = Date.now }) {
  const pendientes = new Map(); // phone -> { mensajes, primero, timer }

  function emitir(phone) {
    const lote = pendientes.get(phone);
    if (!lote) return;
    pendientes.delete(phone);
    clearTimeoutImpl(lote.timer);
    onBatch({ phone, text: lote.mensajes.map((m) => m.text).join('\n'), messages: lote.mensajes });
  }

  return {
    add(phone, mensaje) {
      const lote = pendientes.get(phone) ?? { mensajes: [], primero: now(), timer: null };
      lote.mensajes.push(mensaje);
      clearTimeoutImpl(lote.timer);
      const restante = Math.max(0, maxWaitMs - (now() - lote.primero));
      lote.timer = setTimeoutImpl(() => emitir(phone), Math.min(windowMs, restante));
      lote.timer?.unref?.();
      pendientes.set(phone, lote);
    },
    /** Mientras el cliente "escribe...", se alarga la espera (con el mismo tope). */
    typing(phone) {
      const lote = pendientes.get(phone);
      if (!lote) return;
      clearTimeoutImpl(lote.timer);
      const restante = Math.max(0, maxWaitMs - (now() - lote.primero));
      lote.timer = setTimeoutImpl(() => emitir(phone), Math.min(windowMs, restante));
      lote.timer?.unref?.();
    },
    pendientes: () => pendientes.size,
    flushAll() { for (const phone of [...pendientes.keys()]) emitir(phone); },
  };
}
