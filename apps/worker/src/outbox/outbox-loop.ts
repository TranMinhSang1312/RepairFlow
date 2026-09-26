import type { OutboxProcessor } from "./outbox-processor.js";
import type { WorkerLogger } from "./outbox.types.js";

export class OutboxLoop {
  private timer: NodeJS.Timeout | null = null;
  private currentRun: Promise<void> | null = null;
  private stopped = true;

  constructor(
    private readonly processor: Pick<OutboxProcessor, "runOnce">,
    private readonly logger: WorkerLogger,
    private readonly pollIntervalMs: number,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.currentRun;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.currentRun = this.poll().finally(() => {
        this.currentRun = null;
        this.schedule(this.pollIntervalMs);
      });
    }, delayMs);
  }

  private async poll(): Promise<void> {
    try {
      const summary = await this.processor.runOnce();
      this.logger.debug({ ...summary }, "Outbox poll completed");
    } catch {
      this.logger.error({ errorCode: "OUTBOX_POLL_FAILED" }, "Outbox poll failed");
    }
  }
}
