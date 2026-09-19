import type { Request } from "express";

import type { TenantContext } from "../tenant/tenant-context.js";

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
  };
  tenant?: TenantContext;
}

export interface AccessTokenClaims {
  sub: string;
  iat: number;
  exp: number;
  typ: "access";
  iss: "repairflow-api";
  aud: "repairflow-staff";
}
