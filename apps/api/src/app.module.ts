import { Module } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";
import { loadWorkspaceEnvironment } from "@repairflow/config/node";
import { randomUUID } from "node:crypto";
import { LoggerModule } from "nestjs-pino";

import { HealthController } from "./health/health.controller.js";

loadWorkspaceEnvironment();
const environment = parseApiEnvironment(process.env);

@Module({
  imports: [
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
        redact: {
          paths: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
          censor: "[REDACTED]",
        },
      },
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
