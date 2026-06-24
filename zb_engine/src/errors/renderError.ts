/**
 * renderError.ts — Element render failure handling
 */

export interface RenderErrorInfo {
  elementIndex: number;
  elementType: string;
  message: string;
}

export class RenderError extends Error {
  readonly elementIndex: number;
  readonly elementType: string;

  constructor(elementIndex: number, elementType: string, message: string) {
    super(
      `Element #${elementIndex} (${elementType}) failed: ${message}`,
    );
    this.name = "RenderError";
    this.elementIndex = elementIndex;
    this.elementType = elementType;
  }

  toInfo(): RenderErrorInfo {
    return {
      elementIndex: this.elementIndex,
      elementType: this.elementType,
      message: this.message,
    };
  }
}
