/**
 * sourceError.ts — Source fetch failure handling
 */

export interface SourceErrorInfo {
  sourceId: string;
  message: string;
  statusCode?: number;
}

export class SourceError extends Error {
  readonly sourceId: string;
  readonly statusCode?: number;

  constructor(sourceId: string, message: string, statusCode?: number) {
    super(`Source "${sourceId}" failed: ${message}`);
    this.name = "SourceError";
    this.sourceId = sourceId;
    this.statusCode = statusCode;
  }

  toInfo(): SourceErrorInfo {
    return {
      sourceId: this.sourceId,
      message: this.message,
      statusCode: this.statusCode,
    };
  }
}
