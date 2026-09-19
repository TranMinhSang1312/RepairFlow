/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import type { Device, DeviceType } from "@prisma/client";

import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { tenantWhere } from "../../common/tenant/tenant-where.js";
import { PrismaService } from "../../infra/database/prisma.service.js";

export interface DeviceCreateData {
  customerId: string;
  type: DeviceType;
  brand: string;
  model: string;
  color: string | null;
  serialNormalized: string | null;
  imeiNormalized: string | null;
  notes: string | null;
}

@Injectable()
export class DevicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  listActive(tenant: Pick<TenantContext, "shopId">, customerId: string): Promise<Device[]> {
    return this.prisma.device.findMany({
      where: tenantWhere(tenant, { customerId, archivedAt: null }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  create(tenant: Pick<TenantContext, "shopId">, data: DeviceCreateData): Promise<Device> {
    return this.prisma.device.create({ data: { shopId: tenant.shopId, ...data } });
  }
}
