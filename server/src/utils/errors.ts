import type { NextFunction, Request, Response } from "express";

/** Typed application error with a stable HTTP status code. */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

/** Normalize unexpected failures into JSON responses without leaking internals. */
export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction): void {
  if (error instanceof HttpError) {
    response.status(error.statusCode).json({ error: error.message, details: error.details ?? null });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected server error";
  response.status(500).json({ error: message });
}
