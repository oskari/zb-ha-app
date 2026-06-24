/**
 * httpError.ts — Application error with an HTTP status code
 *
 * Throw this from any route handler (or code invoked by one) to short-circuit
 * Express error handling with a specific status code and client-safe message.
 */

export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}
