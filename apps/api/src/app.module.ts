import { Module } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";
import { loadWorkspaceEnvironment } from "@repairflow/config/node";
import { randomUUID } from "node:crypto";
import { LoggerModule } from "nestjs-pino";

import { PrismaModule } from "./infra/database/prisma.module.js";
import { HealthController } from "./health/health.controller.js";
import { HTTP_LOG_REDACTION } from "./logging.js";
import { IdentityModule } from "./modules/identity/identity.module.js";

loadWorkspaceEnvironment();
const environment = parseApiEnvironment(process.env);

@Module({
  imports: [
    PrismaModule,
    IdentityModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: environment.LOG_LEVEL,
        genReqId(request, response) {
          const supplied = request.headers["x-request-id"];
          const requestId =
            typeof supplied === "string" && supplied.length > 0 ? supplied : randomUUID();
          response.setHeader("X-Request-Id", requestId);
          return requestId;
        },
        redact: HTTP_LOG_REDACTION,
      },
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
