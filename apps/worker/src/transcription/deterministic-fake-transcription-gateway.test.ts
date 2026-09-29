import { describe, expect, it } from "vitest";

import { DeterministicFakeTranscriptionGateway } from "./deterministic-fake-transcription-gateway.js";

describe("DeterministicFakeTranscriptionGateway", () => {
  it("returns deterministic text without retaining or mutating audio", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await new DeterministicFakeTranscriptionGateway("Máy không nhận sạc").transcribe(
      {
        audio: { mediaType: "audio/wav", bytes },
        language: "vi",
        timeoutMs: 1000,
      },
    );
    expect(result.transcript).toBe("Máy không nhận sạc");
    expect([...bytes]).toEqual([1, 2, 3]);
  });
});
