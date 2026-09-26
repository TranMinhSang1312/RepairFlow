import { Module } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";
import { loadWorkspaceEnvironment } from "@repairflow/config/node";
import { randomUUID } from "node:crypto";
import { LoggerModule } from "nestjs-pino";
import { stdSerializers } from "pino";

import { PrismaModule } from "./infra/database/prisma.module.js";
import { HealthController } from "./health/health.controller.js";
import { HTTP_LOG_REDACTION, redactPublicTokenRequest } from "./logging.js";
import { AuthorizationModule } from "./common/authorization/authorization.module.js";
import { CustomersModule } from "./modules/customers/customers.module.js";
import { DevicesModule } from "./modules/devices/devices.module.js";
import { MediaModule } from "./modules/media/media.module.js";
import { RepairOrdersModule } from "./modules/repair-orders/repair-orders.module.js";
import { PublicPortalModule } from "./modules/public-portal/public-portal.module.js";
import { QualityControlModule } from "./modules/quality-control/quality-control.module.js";
import { PaymentsModule } from "./modules/payments/payments.module.js";
import { HandoversModule } from "./modules/handovers/handovers.module.js";
import { WarrantiesModule } from "./modules/warranties/warranties.module.js";
import { StaffMembershipsModule } from "./modules/staff-memberships/staff-memberships.module.js";

loadWorkspaceEnvironment();
const environment = parseApiEnvironment(process.env);

@Module({
  imports: [
    PrismaModule,
    AuthorizationModule,
    CustomersModule,
    DevicesModule,
    MediaModule,
    RepairOrdersModule,
    PublicPortalModule,
    QualityControlModule,
    PaymentsModule,
    HandoversModule,
    WarrantiesModule,
    StaffMembershipsModule,
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
        serializers: {
          req(request) {
            return redactPublicTokenRequest(stdSerializers.req(request));
          },
        },
      },
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
