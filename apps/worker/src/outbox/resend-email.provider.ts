import { OutboxDeliveryError } from "./outbox-errors.js";
import type { NotificationMessage, NotificationProvider } from "./notification-provider.js";

export interface ResendEmailProviderOptions {
  apiUrl: string;
  apiKey: string;
  from: string;
  replyTo?: string;
  timeoutMs: number;
}

export class ResendEmailNotificationProvider implements NotificationProvider {
  constructor(
    private readonly options: ResendEmailProviderOptions,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async deliver(message: NotificationMessage): Promise<{ providerMessageId: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchImplementation(this.options.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(this.options.replyTo ? { reply_to: this.options.replyTo } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const retryable =
          response.status === 408 ||
          response.status === 409 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500;
        throw new OutboxDeliveryError(
          retryable ? "EMAIL_PROVIDER_TEMPORARY_FAILURE" : "EMAIL_PROVIDER_REJECTED",
          retryable,
        );
      }

      const result: unknown = await response.json();
      if (!isProviderResponse(result)) {
        throw new OutboxDeliveryError("EMAIL_PROVIDER_INVALID_RESPONSE");
      }
      return { providerMessageId: result.id };
    } catch (error) {
      if (error instanceof OutboxDeliveryError) throw error;
      if (controller.signal.aborted) {
        throw new OutboxDeliveryError("EMAIL_PROVIDER_TIMEOUT");
      }
      throw new OutboxDeliveryError("EMAIL_PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isProviderResponse(value: unknown): value is { id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    Boolean((value as { id: string }).id.trim())
  );
}
