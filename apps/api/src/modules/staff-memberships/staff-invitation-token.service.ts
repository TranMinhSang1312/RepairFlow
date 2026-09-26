import { Injectable } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";
import { createHash, createHmac } from "node:crypto";

export interface StaffInvitationTokenMetadata {
  invitationId: string;
  expiresAt: string;
}

@Injectable()
export class StaffInvitationTokenService {
  private readonly secret: string;
  private readonly publicWebUrl: string;

  constructor() {
    const environment = parseApiEnvironment(process.env);
    this.secret = environment.PUBLIC_TOKEN_SECRET ?? environment.ACCESS_TOKEN_SECRET;
    this.publicWebUrl = environment.PUBLIC_WEB_URL;
  }

  deriveRaw(metadata: StaffInvitationTokenMetadata): string {
    return createHmac("sha256", this.secret)
      .update(
        JSON.stringify({
          version: 1,
          purpose: "ACCEPT_STAFF_INVITATION",
          invitationId: metadata.invitationId,
          expiresAt: metadata.expiresAt,
        }),
      )
      .digest("base64url");
  }

  hash(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }

  publicUrl(metadata: StaffInvitationTokenMetadata): string {
    return new URL(
      `/join/${encodeURIComponent(this.deriveRaw(metadata))}`,
      this.publicWebUrl,
    ).toString();
  }

  emailFingerprint(email: string): string {
    return createHmac("sha256", this.secret)
      .update(`staff-invitation-email:v1:${email}`)
      .digest("hex");
  }

  rateLimitKey(rawToken: string, ip: string): string {
    return createHmac("sha256", this.secret)
      .update(`staff-invitation-rate:v1:${rawToken}\u0000${ip}`)
      .digest("hex");
  }
}
