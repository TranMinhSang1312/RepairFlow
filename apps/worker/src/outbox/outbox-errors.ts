const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;

export class OutboxDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = true,
  ) {
    super(code);
    this.name = "OutboxDeliveryError";
  }
}

export function isRetryableOutboxError(error: unknown): boolean {
  return !(error instanceof OutboxDeliveryError) || error.retryable;
}

export function safeOutboxErrorCode(error: unknown): string {
  if (error instanceof OutboxDeliveryError && SAFE_ERROR_CODE.test(error.code)) {
    return error.code;
  }
  return "UNEXPECTED_DELIVERY_FAILURE";
}
