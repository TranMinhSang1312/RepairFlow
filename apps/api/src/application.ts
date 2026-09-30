import {
  HttpStatus,
  RequestMethod,
  ValidationPipe,
  type INestApplication,
  type ValidationError,
} from "@nestjs/common";
import type { ErrorDetail } from "@repairflow/contracts";
import { parseApiEnvironment } from "@repairflow/config";
import { Logger } from "nestjs-pino";

import { ApiException } from "./common/api-exception.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";

function validationDetails(errors: ValidationError[], parent = ""): ErrorDetail[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const ownDetails = Object.values(error.constraints ?? {}).map((message) => ({
      field,
      code: "INVALID_FIELD",
      message,
    }));

    return [...ownDetails, ...validationDetails(error.children ?? [], field)];
  });
}

export function configureApplication(app: INestApplication): INestApplication {
  const environment = parseApiEnvironment(process.env);
  const express = app.getHttpAdapter().getInstance() as {
    set(name: string, value: number): void;
  };
  express.set("trust proxy", environment.API_TRUST_PROXY_HOPS);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix("api/v1", {
    exclude: [{ path: "public/v1/{*path}", method: RequestMethod.ALL }],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "VALIDATION_FAILED",
          "One or more input fields are invalid.",
          validationDetails(errors),
        ),
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
