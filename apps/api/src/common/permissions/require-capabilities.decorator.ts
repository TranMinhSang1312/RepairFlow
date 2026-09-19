import { SetMetadata } from "@nestjs/common";

import type { Capability } from "./capability.js";

export const REQUIRED_CAPABILITIES = Symbol("repairflow.required-capabilities");

export const RequireCapabilities = (
  ...capabilities: Capability[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_CAPABILITIES, capabilities);
