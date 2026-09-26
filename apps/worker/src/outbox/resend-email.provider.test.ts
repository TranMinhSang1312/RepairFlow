import { describe, expect, it, vi } from "vitest";

import { OutboxDeliveryError } from "./outbox-errors.js";
import type { NotificationMessage } from "./notification-provider.js";
import { ResendEmailNotificationProvider } from "./resend-email.provider.js";

const message: NotificationMessage = {
  outboxEventId: "event-id",
  notificationDeliveryId: "delivery-id",
  channel: "EMAIL",
  idempotencyKey: "outbox:event-id:notification:delivery-id",
  to: "snapshot@example.test",
  subject: "Quote ready",
  text: "Open https://example.test/p/private-token",
  html: '<a href="https://example.test/p/private-token">Open</a>',
};

function provider(fetchImplementation: typeof fetch, timeoutMs = 1000) {
  return new ResendEmailNotificationProvider(
    {
      apiUrl: "https://api.resend.test/emails",
      apiKey: "secret-api-key",
      from: "RepairFlow <notify@example.test>",
      replyTo: "support@example.test",
      timeoutMs,
    },
    fetchImplementation,
  );
}

describe("ResendEmailNotificationProvider", () => {
  it("sends the rendered email with a stable provider idempotency key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "provider-message-id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(provider(fetchMock).deliver(message)).resolves.toEqual({
      providerMessageId: "provider-message-id",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.test/emails");
    expect(new Headers(request?.headers).get("Idempotency-Key")).toBe(message.idempotencyKey);
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer secret-api-key");
    expect(JSON.parse(String(request?.body))).toEqual({
      from: "RepairFlow <notify@example.test>",
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      reply_to: "support@example.test",
    });
  });

  it.each([
    [429, "EMAIL_PROVIDER_TEMPORARY_FAILURE", true],
    [503, "EMAIL_PROVIDER_TEMPORARY_FAILURE", true],
    [422, "EMAIL_PROVIDER_REJECTED", false],
  ])("classifies HTTP %i without retaining the response body", async (status, code, retryable) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("provider response must stay private", { status }));
    const failure = provider(fetchMock).deliver(message);
    await expect(failure).rejects.toMatchObject({ code, retryable });
    await expect(failure).rejects.not.toThrow("provider response must stay private");
  });

  it("turns network and timeout failures into safe retryable codes", async () => {
    const unavailable = vi.fn<typeof fetch>().mockRejectedValue(new Error("socket secret"));
    await expect(provider(unavailable).deliver(message)).rejects.toMatchObject({
      code: "EMAIL_PROVIDER_UNAVAILABLE",
      retryable: true,
    });

    const hanging = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    await expect(provider(hanging, 1).deliver(message)).rejects.toMatchObject({
      code: "EMAIL_PROVIDER_TIMEOUT",
      retryable: true,
    });
  });

  it("rejects a successful provider response without a message id", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(provider(fetchMock).deliver(message)).rejects.toEqual(
      new OutboxDeliveryError("EMAIL_PROVIDER_INVALID_RESPONSE"),
    );
  });
});
