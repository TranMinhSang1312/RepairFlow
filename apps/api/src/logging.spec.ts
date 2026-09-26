import pino from "pino";
import { describe, expect, it } from "vitest";

import { HTTP_LOG_REDACTION } from "./logging.js";

describe("HTTP log redaction", () => {
  it("removes authentication cookies, tokens, and passwords", () => {
    const lines: string[] = [];
    const logger = pino(
      { redact: HTTP_LOG_REDACTION },
      {
        write(message: string) {
          lines.push(message);
        },
      },
    );

    logger.info({
      req: {
        headers: {
          authorization: "Bearer access-token-secret",
          cookie: "repairflow_refresh=refresh-token-secret",
          "x-repairflow-invitation-token": "staff-invitation-secret",
        },
        body: {
          password: "password-secret",
          accessToken: "access-token-body-secret",
          refreshToken: "refresh-token-body-secret",
        },
      },
      res: {
        headers: {
          "set-cookie": "repairflow_refresh=response-cookie-secret",
        },
      },
    });

    const output = lines.join("\n");
    expect(output).toContain("[REDACTED]");
    for (const secret of [
      "access-token-secret",
      "refresh-token-secret",
      "password-secret",
      "access-token-body-secret",
      "refresh-token-body-secret",
      "response-cookie-secret",
      "staff-invitation-secret",
    ]) {
      expect(output).not.toContain(secret);
    }
  });
});
