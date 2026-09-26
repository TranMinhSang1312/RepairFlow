import { isRetryableOutboxError, safeOutboxErrorCode } from "./outbox-errors.js";
import type { OutboxHandler } from "./notification-outbox-handler.js";
import type { OutboxRepository } from "./outbox-repository.js";
import type {
  ClaimedOutboxEvent,
  OutboxRunSummary,
  OutboxWorkerOptions,
  WorkerLogger,
} from "./outbox.types.js";

export class OutboxProcessor {
  constructor(
    private readonly repository: Pick<
      OutboxRepository,
      "claimBatch" | "completeClaim" | "failClaim"
    >,
    private readonly handler: OutboxHandler,
    private readonly logger: WorkerLogger,
    private readonly workerId: string,
    private readonly options: OutboxWorkerOptions,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async runOnce(): Promise<OutboxRunSummary> {
    const events = await this.repository.claimBatch(this.workerId, this.clock(), this.options);
    const summary: OutboxRunSummary = {
      claimed: events.length,
      completed: 0,
      retried: 0,
      deadLettered: 0,
    };

    const outcomes = await Promise.all(events.map((event) => this.processEvent(event)));
    for (const outcome of outcomes) {
      if (outcome === "COMPLETED") summary.completed += 1;
      else if (outcome === "DEAD_LETTER") summary.deadLettered += 1;
      else summary.retried += 1;
    }
    return summary;
  }

  private async processEvent(
    event: ClaimedOutboxEvent,
  ): Promise<"COMPLETED" | "RETRY" | "DEAD_LETTER"> {
    try {
      await this.handler.handle(event, this.clock());
      await this.repository.completeClaim(event.id, this.workerId, this.clock());
      this.logger.info(
        { outboxEventId: event.id, eventType: event.eventType, attempt: event.attempts },
        "Outbox event completed",
      );
      return "COMPLETED";
    } catch (error) {
      const errorCode = safeOutboxErrorCode(error);
      const result = await this.repository.failClaim(
        event,
        this.workerId,
        errorCode,
        this.clock(),
        this.options,
        !isRetryableOutboxError(error),
      );
      this.logger.warn(
        {
          outboxEventId: event.id,
          eventType: event.eventType,
          attempt: event.attempts,
          errorCode,
          result,
        },
        "Outbox event delivery failed",
      );
      return result;
    }
  }
}
