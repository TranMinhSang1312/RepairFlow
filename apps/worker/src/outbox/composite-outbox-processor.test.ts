import { describe, expect, it, vi } from "vitest";

import { CompositeOutboxProcessor } from "./composite-outbox-processor.js";

describe("CompositeOutboxProcessor", () => {
  it("runs notification and AI processors and aggregates their summaries", async () => {
    const notification = {
      runOnce: vi.fn().mockResolvedValue({ claimed: 2, completed: 1, retried: 1, deadLettered: 0 }),
    };
    const ai = {
      runOnce: vi.fn().mockResolvedValue({ claimed: 1, completed: 1, retried: 0, deadLettered: 0 }),
    };

    await expect(new CompositeOutboxProcessor([notification, ai]).runOnce()).resolves.toEqual({
      claimed: 3,
      completed: 2,
      retried: 1,
      deadLettered: 0,
    });
    expect(notification.runOnce).toHaveBeenCalledOnce();
    expect(ai.runOnce).toHaveBeenCalledOnce();
  });
});
