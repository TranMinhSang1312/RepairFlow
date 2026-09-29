import type {
  TranscriptionGateway,
  TranscriptionRequest,
  TranscriptionResult,
} from "./transcription-gateway.js";
import { TranscriptionError } from "./transcription-gateway.js";

export class DeterministicFakeTranscriptionGateway implements TranscriptionGateway {
  readonly provider = "fake";

  constructor(
    private readonly transcript = "Khách báo máy tự tắt nguồn. Ngoại quan có vết xước nhẹ. Phụ kiện gồm ốp lưng.",
    private readonly unavailable = false,
  ) {}

  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    if (this.unavailable || request.audio.bytes.byteLength === 0) {
      return Promise.reject(new TranscriptionError("AI_TRANSCRIPTION_UNAVAILABLE"));
    }
    return Promise.resolve({
      transcript: this.transcript,
      provider: "fake",
      model: "fake-transcription-v1",
      latencyMs: 1,
    });
  }
}
