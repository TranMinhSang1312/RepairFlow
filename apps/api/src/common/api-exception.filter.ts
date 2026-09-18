import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { ErrorDetail, ErrorEnvelope, FoundationErrorCode } from "@repairflow/contracts";
import type { Request, Response } from "express";

type RequestWithId = Request & { id?: string };

interface NestValidationBody {
  message?: string | string[];
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const requestId = request.id ?? String(response.getHeader("X-Request-Id") ?? "unknown");
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    const details = this.extractDetails(body);
    const code = this.codeForStatus(status);

    if (status >= 500) {
      this.logger.error({ requestId, exception }, "Unhandled API exception");
    }

    const envelope: ErrorEnvelope = {
      error: {
        code,
        message: status >= 500 ? "An unexpected error occurred." : this.messageFor(body, status),
        requestId,
        ...(details.length > 0 ? { details } : {}),
      },
    };

    response.status(status).json(envelope);
  }

  private codeForStatus(status: number): FoundationErrorCode {
    const codeByStatus: Partial<Record<number, FoundationErrorCode>> = {
      [HttpStatus.BAD_REQUEST]: "VALIDATION_FAILED",
      [HttpStatus.UNAUTHORIZED]: "AUTH_REQUIRED",
      [HttpStatus.FORBIDDEN]: "PERMISSION_DENIED",
      [HttpStatus.NOT_FOUND]: "RESOURCE_NOT_FOUND",
      [HttpStatus.CONFLICT]: "CONCURRENT_UPDATE",
      [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMITED",
    };

    return codeByStatus[status] ?? "INTERNAL_ERROR";
  }

  private messageFor(body: string | object | undefined, status: number): string {
    if (typeof body === "string") {
      return body;
    }

    if (body && "message" in body) {
      const message = (body as NestValidationBody).message;
      if (typeof message === "string") {
        return message;
      }
    }

    return status === 404 ? "Resource not found." : "The request could not be processed.";
  }

  private extractDetails(body: string | object | undefined): ErrorDetail[] {
    if (!body || typeof body === "string" || !("message" in body)) {
      return [];
    }

    const message = (body as NestValidationBody).message;
    if (!Array.isArray(message)) {
      return [];
    }

    return message.map((item) => ({ code: "INVALID_FIELD", message: item }));
  }
}
