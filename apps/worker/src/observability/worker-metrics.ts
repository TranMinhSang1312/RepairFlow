import type { OutboxRunSummary, WorkerLogger } from "../outbox/outbox.types.js";

export interface WorkerMetricSnapshot {
  pollsTotal: number;
  pollFailuresTotal: number;
  consecutivePollFailures: number;
  claimedTotal: number;
  completedTotal: number;
  retriedTotal: number;
  deadLetteredTotal: number;
  inFlight: number;
  lastPollStartedAt: Date | null;
  lastPollCompletedAt: Date | null;
  lastPollSucceededAt: Date | null;
}

export interface OutboxLoopObserver {
  pollStarted(): void;
  pollSucceeded(summary: OutboxRunSummary): void;
  pollFailed(): void;
}

export class WorkerMetrics implements OutboxLoopObserver {
  private state: WorkerMetricSnapshot = {
    pollsTotal: 0,
    pollFailuresTotal: 0,
    consecutivePollFailures: 0,
    claimedTotal: 0,
    completedTotal: 0,
    retriedTotal: 0,
    deadLetteredTotal: 0,
    inFlight: 0,
    lastPollStartedAt: null,
    lastPollCompletedAt: null,
    lastPollSucceededAt: null,
  };
  private failureAlertOpen = false;

  constructor(
    private readonly logger: WorkerLogger,
    private readonly failureAlertThreshold: number,
    private readonly deadLetterAlertThreshold: number,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  pollStarted(): void {
    this.state.pollsTotal += 1;
    this.state.inFlight = 1;
    this.state.lastPollStartedAt = this.clock();
  }

  pollSucceeded(summary: OutboxRunSummary): void {
    const now = this.clock();
    this.state.inFlight = 0;
    this.state.consecutivePollFailures = 0;
    this.state.claimedTotal += summary.claimed;
    this.state.completedTotal += summary.completed;
    this.state.retriedTotal += summary.retried;
    this.state.deadLetteredTotal += summary.deadLettered;
    this.state.lastPollCompletedAt = now;
    this.state.lastPollSucceededAt = now;
    this.failureAlertOpen = false;
    if (summary.deadLettered >= this.deadLetterAlertThreshold) {
      this.logger.error(
        {
          event: "worker.alert",
          service: "worker",
          alertCode: "OUTBOX_DEAD_LETTER_THRESHOLD",
          deadLettered: summary.deadLettered,
          threshold: this.deadLetterAlertThreshold,
        },
        "Worker alert threshold reached",
      );
    }
  }

  pollFailed(): void {
    this.state.inFlight = 0;
    this.state.pollFailuresTotal += 1;
    this.state.consecutivePollFailures += 1;
    this.state.lastPollCompletedAt = this.clock();
    if (
      !this.failureAlertOpen &&
      this.state.consecutivePollFailures >= this.failureAlertThreshold
    ) {
      this.failureAlertOpen = true;
      this.logger.error(
        {
          event: "worker.alert",
          service: "worker",
          alertCode: "OUTBOX_POLL_FAILURE_THRESHOLD",
          consecutiveFailures: this.state.consecutivePollFailures,
          threshold: this.failureAlertThreshold,
        },
        "Worker alert threshold reached",
      );
    }
  }

  snapshot(): WorkerMetricSnapshot {
    return { ...this.state };
  }

  prometheus(): string {
    const snapshot = this.snapshot();
    const lastSuccess = snapshot.lastPollSucceededAt
      ? snapshot.lastPollSucceededAt.getTime() / 1000
      : 0;
    return [
      "# HELP repairflow_worker_polls_total Total outbox polls started.",
      "# TYPE repairflow_worker_polls_total counter",
      `repairflow_worker_polls_total ${snapshot.pollsTotal}`,
      "# HELP repairflow_worker_poll_failures_total Total failed outbox polls.",
      "# TYPE repairflow_worker_poll_failures_total counter",
      `repairflow_worker_poll_failures_total ${snapshot.pollFailuresTotal}`,
      "# TYPE repairflow_worker_claimed_total counter",
      `repairflow_worker_claimed_total ${snapshot.claimedTotal}`,
      "# TYPE repairflow_worker_completed_total counter",
      `repairflow_worker_completed_total ${snapshot.completedTotal}`,
      "# TYPE repairflow_worker_retried_total counter",
      `repairflow_worker_retried_total ${snapshot.retriedTotal}`,
      "# TYPE repairflow_worker_dead_lettered_total counter",
      `repairflow_worker_dead_lettered_total ${snapshot.deadLetteredTotal}`,
      "# TYPE repairflow_worker_poll_in_flight gauge",
      `repairflow_worker_poll_in_flight ${snapshot.inFlight}`,
      "# TYPE repairflow_worker_consecutive_poll_failures gauge",
      `repairflow_worker_consecutive_poll_failures ${snapshot.consecutivePollFailures}`,
      "# TYPE repairflow_worker_last_success_unixtime_seconds gauge",
      `repairflow_worker_last_success_unixtime_seconds ${lastSuccess}`,
      "",
    ].join("\n");
  }
}
