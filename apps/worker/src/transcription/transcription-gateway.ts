export interface TranscriptionRequest {
  audio: {
    mediaType: "audio/wav" | "audio/x-wav";
    bytes: Uint8Array;
  };
  language: "vi";
  timeoutMs: number;
}

export interface TranscriptionResult {
  transcript: string;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface TranscriptionGateway {
  readonly provider: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

export class TranscriptionError extends Error {
  constructor(readonly code: "AI_TRANSCRIPTION_UNAVAILABLE") {
    super(code);
    this.name = "TranscriptionError";
  }
}
