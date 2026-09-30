import { Module } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { MediaModule } from "../media/media.module.js";
import { AiCapabilitiesController } from "./ai-capabilities.controller.js";
import { AiAnalyticsService } from "./ai-analytics.service.js";
import { AiEnqueueService } from "./ai-enqueue.service.js";
import { AiRepository } from "./ai.repository.js";
import { AiRunsController } from "./ai-runs.controller.js";
import { AiRunsService } from "./ai-runs.service.js";
import { AiSettingsController } from "./ai-settings.controller.js";
import { AiSettingsService } from "./ai-settings.service.js";
import {
  AI_GLOBAL_ENABLED,
  AI_INTAKE_AUDIO_ENABLED,
  AI_MAX_AUDIO_BYTES,
  AI_MAX_IMAGE_BYTES,
  AI_TRANSCRIPTION_PROVIDER,
} from "./ai.tokens.js";
import { DeviceOcrController } from "./capabilities/device-ocr/device-ocr.controller.js";
import { DeviceOcrRepository } from "./capabilities/device-ocr/device-ocr.repository.js";
import { DeviceOcrService } from "./capabilities/device-ocr/device-ocr.service.js";
import { IntakeDraftController } from "./capabilities/intake-draft/intake-draft.controller.js";
import { IntakeDraftRepository } from "./capabilities/intake-draft/intake-draft.repository.js";
import { IntakeDraftService } from "./capabilities/intake-draft/intake-draft.service.js";
import { ChecklistSuggestionController } from "./capabilities/checklist-suggestion/checklist-suggestion.controller.js";
import { ChecklistSuggestionRepository } from "./capabilities/checklist-suggestion/checklist-suggestion.repository.js";
import { ChecklistSuggestionService } from "./capabilities/checklist-suggestion/checklist-suggestion.service.js";
import { CustomerSummaryController } from "./capabilities/customer-summary/customer-summary.controller.js";
import { CustomerSummaryRepository } from "./capabilities/customer-summary/customer-summary.repository.js";
import { CustomerSummaryService } from "./capabilities/customer-summary/customer-summary.service.js";

@Module({
  imports: [IdempotencyModule, MediaModule],
  controllers: [
    AiSettingsController,
    AiCapabilitiesController,
    AiRunsController,
    CustomerSummaryController,
    DeviceOcrController,
    IntakeDraftController,
    ChecklistSuggestionController,
  ],
  providers: [
    AiRepository,
    AiAnalyticsService,
    AiSettingsService,
    AiRunsService,
    AiEnqueueService,
    CustomerSummaryRepository,
    CustomerSummaryService,
    DeviceOcrRepository,
    DeviceOcrService,
    IntakeDraftRepository,
    IntakeDraftService,
    ChecklistSuggestionRepository,
    ChecklistSuggestionService,
    {
      provide: AI_GLOBAL_ENABLED,
      useFactory: () => parseApiEnvironment(process.env).AI_ENABLED,
    },
    {
      provide: AI_MAX_IMAGE_BYTES,
      useFactory: () => parseApiEnvironment(process.env).AI_MAX_IMAGE_BYTES,
    },
    {
      provide: AI_INTAKE_AUDIO_ENABLED,
      useFactory: () => parseApiEnvironment(process.env).AI_INTAKE_AUDIO_ENABLED,
    },
    {
      provide: AI_TRANSCRIPTION_PROVIDER,
      useFactory: () => parseApiEnvironment(process.env).AI_TRANSCRIPTION_PROVIDER,
    },
    {
      provide: AI_MAX_AUDIO_BYTES,
      useFactory: () => parseApiEnvironment(process.env).AI_MAX_AUDIO_BYTES,
    },
  ],
  exports: [AiEnqueueService],
})
export class AiModule {}
