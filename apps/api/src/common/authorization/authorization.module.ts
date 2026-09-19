import { Global, Module } from "@nestjs/common";

import { PermissionGuard } from "../permissions/permission.guard.js";
import { TenantGuard } from "../tenant/tenant.guard.js";
import { IdentityModule } from "../../modules/identity/identity.module.js";

@Global()
@Module({
  imports: [IdentityModule],
  providers: [TenantGuard, PermissionGuard],
  exports: [IdentityModule, TenantGuard, PermissionGuard],
})
export class AuthorizationModule {}
