import type { ErrorRequestHandler } from 'express';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message ?? code);
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    if (err.retryAfterSeconds) res.set('Retry-After', String(err.retryAfterSeconds));
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    res.status(400).json({ error: 'bad_request', message: 'Invalid request body' });
    return;
  }
  console.error(JSON.stringify({ level: 'error', msg: 'unhandled_error', error: String(err?.message ?? err) }));
  res.status(500).json({ error: 'internal_error', message: 'Something went wrong' });
};
