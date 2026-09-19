import type { TenantContext } from "./tenant-context.js";

export function tenantWhere<TWhere extends object>(
  tenant: Pick<TenantContext, "shopId">,
  where: TWhere,
): TWhere & { shopId: string } {
  return { ...where, shopId: tenant.shopId };
}
