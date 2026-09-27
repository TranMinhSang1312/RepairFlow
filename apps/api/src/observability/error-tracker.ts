import { Logger } from "@nestjs/common";

export interface StructuredApiErrorEvent {
  event: "api.request.error";
  service: "api";
  requestId: string;
  method: string;
  route: string;
  statusCode: number;
  errorCode: string;
}

export interface ErrorTracker {
  capture(event: StructuredApiErrorEvent): void;
}

export class StructuredLogErrorTracker implements ErrorTracker {
  private readonly logger = new Logger("StructuredErrorTracker");

  capture(event: StructuredApiErrorEvent): void {
    this.logger.error(event, "API request failed");
  }
}
