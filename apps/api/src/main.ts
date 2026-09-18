import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { parseApiEnvironment } from "@repairflow/config";

import { AppModule } from "./app.module.js";
import { configureApplication } from "./application.js";

async function bootstrap(): Promise<void> {
  const environment = parseApiEnvironment(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  configureApplication(app);
  await app.listen(environment.API_PORT, environment.API_HOST);
}

void bootstrap();
