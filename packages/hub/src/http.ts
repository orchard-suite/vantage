/** Errors a route throws to answer with a status; the app turns them into JSON. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what: string): HttpError => new HttpError(404, `${what} not found`);
export const forbidden = (why = 'forbidden'): HttpError => new HttpError(403, why);
export const unauthorized = (why = 'sign in required'): HttpError => new HttpError(401, why);
export const badRequest = (why: string, details?: Record<string, unknown>): HttpError => new HttpError(400, why, details);
export const conflict = (why: string): HttpError => new HttpError(409, why);
