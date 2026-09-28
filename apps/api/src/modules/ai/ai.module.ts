import { Module } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";

import { IdempotencyModule } from "../../common/idempotency/idempotency.module.js";
import { AiEnqueueService } from "./ai-enqueue.service.js";
import { AiRepository } from "./ai.repository.js";
import { AiRunsController } from "./ai-runs.controller.js";
import { AiRunsService } from "./ai-runs.service.js";
import { AiSettingsController } from "./ai-settings.controller.js";
import { AiSettingsService } from "./ai-settings.service.js";
import { AI_GLOBAL_ENABLED } from "./ai.tokens.js";

@Module({
  imports: [IdempotencyModule],
  controllers: [AiSettingsController, AiRunsController],
  providers: [
    AiRepository,
    AiSettingsService,
    AiRunsService,
    AiEnqueueService,
    {
      provide: AI_GLOBAL_ENABLED,
      useFactory: () => parseApiEnvironment(process.env).AI_ENABLED,
    },
  ],
  exports: [AiEnqueueService],
})
export class AiModule {}
