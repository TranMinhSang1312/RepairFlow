import type { OutboxRunSummary } from "./outbox.types.js";

export interface RunnableOutboxProcessor {
  runOnce(): Promise<OutboxRunSummary>;
}

/** Runs isolated outbox pipelines in one poll and reports one aggregate health summary. */
export class CompositeOutboxProcessor implements RunnableOutboxProcessor {
  constructor(private readonly processors: readonly RunnableOutboxProcessor[]) {
    if (processors.length === 0) throw new RangeError("At least one outbox processor is required");
  }

  async runOnce(): Promise<OutboxRunSummary> {
    const summaries = await Promise.all(this.processors.map((processor) => processor.runOnce()));
    return summaries.reduce<OutboxRunSummary>(
      (total, summary) => ({
        claimed: total.claimed + summary.claimed,
        completed: total.completed + summary.completed,
        retried: total.retried + summary.retried,
        deadLettered: total.deadLettered + summary.deadLettered,
      }),
      { claimed: 0, completed: 0, retried: 0, deadLettered: 0 },
    );
  }
}
