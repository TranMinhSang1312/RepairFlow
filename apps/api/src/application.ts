import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Logger } from "nestjs-pino";

import { ApiExceptionFilter } from "./common/api-exception.filter.js";

export function configureApplication(app: INestApplication): INestApplication {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
