import { z } from 'zod';

/** Esquemas de entrada/salida de la capa de IA. Toda respuesta del modelo se valida contra estos esquemas antes de usarse. */
export const AiInput = z.object({
  fincaId: z.number().int(),
  usuarioId: z.number().int().nullable().optional(),
  canal: z.enum(['whatsapp', 'web']).default('whatsapp'),
  texto: z.string().min(1).max(2000),
});

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const PropuestaCosecha = z.object({ tipo: z.literal('cosecha'), lote: z.string().min(1), cultivo: z.string().optional(), cantidad: z.number().gt(0), unidad: z.string().min(1).max(15), fecha: fecha.optional() });
export const PropuestaLabor = z.object({ tipo: z.literal('labor'), lote: z.string().min(1), labor: z.string().min(1).max(60), fecha: fecha.optional(), observaciones: z.string().max(300).optional() });
export const PropuestaRiego = z.object({ tipo: z.literal('riego'), lote: z.string().min(1), fecha: fecha.optional(), duracion_min: z.number().int().positive().optional() });
export const Consulta = z.object({ tipo: z.literal('consulta'), tema: z.enum(['inventario', 'labores', 'ventas', 'aplicaciones']), filtro: z.string().max(100).optional() });

/** Salida esperada del modelo. Las dosis NUNCA forman parte del esquema: no se aceptan ni se generan. */
export const AiOutput = z.object({
  intencion: z.discriminatedUnion('tipo', [PropuestaCosecha, PropuestaLabor, PropuestaRiego, Consulta]).nullable(),
  respuesta: z.string().max(1000),
  requiereConfirmacion: z.boolean(),
}).strict();
