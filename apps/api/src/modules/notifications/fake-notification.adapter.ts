import { HttpStatus, Injectable } from "@nestjs/common";
import { NotificationChannel } from "@prisma/client";
import { parseApiEnvironment } from "@repairflow/config";
import {
  deriveNotificationDestinationHash,
  normalizeNotificationDestination,
} from "@repairflow/security";

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

    const destination = normalizeNotificationDestination(
      channel,
      channel === QuoteSendChannel.EMAIL ? snapshot.email : snapshot.phone,
    );
    if (!destination) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "QUOTE_DESTINATION_REQUIRED",
        `The customer snapshot has no destination for ${channel}.`,
      );
    }

    return {
      channel: NotificationChannel[channel],
      destinationHash: deriveNotificationDestinationHash(
        this.destinationHashSecret,
        channel,
        destination,
      ),
    };
  }
}
