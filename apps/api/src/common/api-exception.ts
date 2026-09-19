import { HttpException, type HttpStatus } from "@nestjs/common";
import type { ErrorDetail } from "@repairflow/contracts";

export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    details?: ErrorDetail[],
    readonly responseHeaders: Readonly<Record<string, string>> = {},
  ) {
    super({ code, message, ...(details && details.length > 0 ? { details } : {}) }, status);
  }
}
