export class AppError extends Error {
  constructor(status, message, code = 'ERROR', details) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
}
export const badRequest = (m, d) => new AppError(400, m, 'BAD_REQUEST', d);
export const unauthorized = (m = 'No autenticado') => new AppError(401, m, 'UNAUTHORIZED');
export const forbidden = (m = 'No tienes permiso para esta acción') => new AppError(403, m, 'FORBIDDEN');
export const notFound = (m = 'Recurso no encontrado') => new AppError(404, m, 'NOT_FOUND');
export const conflict = (m, d) => new AppError(409, m, 'CONFLICT', d);
export const unprocessable = (m, d) => new AppError(422, m, 'BUSINESS_RULE', d);
