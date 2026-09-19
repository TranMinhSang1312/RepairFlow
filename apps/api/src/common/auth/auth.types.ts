import type { Request } from "express";

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
  };
}

export interface AccessTokenClaims {
  sub: string;
  iat: number;
  exp: number;
  typ: "access";
  iss: "repairflow-api";
  aud: "repairflow-staff";
}
