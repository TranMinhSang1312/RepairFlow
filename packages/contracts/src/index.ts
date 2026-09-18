export const FOUNDATION_ERROR_CODES = [
  "REQUEST_MALFORMED",
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "RESOURCE_NOT_FOUND",
  "CONCURRENT_UPDATE",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type FoundationErrorCode = (typeof FOUNDATION_ERROR_CODES)[number];

export interface ErrorDetail {
  field?: string;
  code: string;
  message?: string;
}

export interface ErrorEnvelope {
  error: {
    code: FoundationErrorCode | string;
    message: string;
    requestId: string;
    details?: ErrorDetail[];
  };
}

export interface HealthResponse {
  service: "api" | "web" | "worker";
  status: "ok";
  version: string;
  timestamp: string;
}
