import { Module } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { MediaModule } from "../media/media.module.js";
import { AiCapabilitiesController } from "./ai-capabilities.controller.js";
import { AiEnqueueService } from "./ai-enqueue.service.js";
import { AiRepository } from "./ai.repository.js";
import { AiRunsController } from "./ai-runs.controller.js";
import { AiRunsService } from "./ai-runs.service.js";
import { AiSettingsController } from "./ai-settings.controller.js";
import { AiSettingsService } from "./ai-settings.service.js";
import { AI_GLOBAL_ENABLED } from "./ai.tokens.js";
import { AI_MAX_IMAGE_BYTES } from "./ai.tokens.js";
import { DeviceOcrController } from "./capabilities/device-ocr/device-ocr.controller.js";
import { DeviceOcrRepository } from "./capabilities/device-ocr/device-ocr.repository.js";
import { DeviceOcrService } from "./capabilities/device-ocr/device-ocr.service.js";
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
  ],
  providers: [
    AiRepository,
    AiSettingsService,
    AiRunsService,
    AiEnqueueService,
    CustomerSummaryRepository,
    CustomerSummaryService,
    DeviceOcrRepository,
    DeviceOcrService,
    {
      provide: AI_GLOBAL_ENABLED,
      useFactory: () => parseApiEnvironment(process.env).AI_ENABLED,
    },
    {
      provide: AI_MAX_IMAGE_BYTES,
      useFactory: () => parseApiEnvironment(process.env).AI_MAX_IMAGE_BYTES,
    },
  ],
  exports: [AiEnqueueService],
})
export class AiModule {}
