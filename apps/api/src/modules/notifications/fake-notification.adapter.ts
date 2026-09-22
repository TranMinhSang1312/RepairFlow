import { HttpStatus, Injectable } from "@nestjs/common";
import { NotificationChannel } from "@prisma/client";
import { parseApiEnvironment } from "@repairflow/config";
import { createHmac } from "node:crypto";

import { ApiException } from "../../common/api-exception.js";
import { QuoteSendChannel } from "../quotes/quote.dto.js";

export interface NotificationPlan {
  channel: NotificationChannel;
  destinationHash: string;
}

interface CustomerSnapshot {
  email?: unknown;
  phone?: unknown;
}

/** Deterministic local boundary. It performs no network I/O and retains no destination. */
@Injectable()
export class FakeNotificationAdapter {
  private readonly destinationHashSecret: string;

  constructor() {
    const environment = parseApiEnvironment(process.env);
    this.destinationHashSecret = environment.PUBLIC_TOKEN_SECRET ?? environment.ACCESS_TOKEN_SECRET;
  }

  plan(channel: QuoteSendChannel, snapshot: CustomerSnapshot): NotificationPlan | null {
    if (channel === QuoteSendChannel.COPY_LINK) return null;

    const destination =
      channel === QuoteSendChannel.EMAIL
        ? this.normalizedString(snapshot.email)?.toLowerCase()
        : this.normalizedString(snapshot.phone)?.replace(/[\s().-]/gu, "");
    if (!destination) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "QUOTE_DESTINATION_REQUIRED",
        `The customer snapshot has no destination for ${channel}.`,
      );
    }

    return {
      channel: NotificationChannel[channel],
      destinationHash: createHmac("sha256", this.destinationHashSecret)
        .update(`notification-destination:v1:${channel}:${destination}`)
        .digest("hex"),
    };
  }

  private normalizedString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
}
