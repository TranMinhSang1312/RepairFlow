/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime for DI. */

import { Injectable } from "@nestjs/common";
import type { Customer, Prisma } from "@prisma/client";

import { PrismaService } from "../../infra/database/prisma.service.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { tenantWhere } from "../../common/tenant/tenant-where.js";

const PAGE_SIZE = 25;

export interface CustomerCursor {
  id: string;
  createdAt: Date;
}

export interface CustomerCreateData {
  name: string;
  phoneRaw: string;
  phoneNormalized: string;
  email: string | null;
  notes: string | null;
}

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenant: Pick<TenantContext, "shopId">,
    search: { name: string; phone: string | null } | null,
    cursor: CustomerCursor | null,
  ): Promise<{ customers: Customer[]; hasMore: boolean }> {
    const cursorCondition: Prisma.CustomerWhereInput | undefined = cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : undefined;
    const searchCondition: Prisma.CustomerWhereInput | undefined = search
      ? {
          OR: [
            { name: { contains: search.name, mode: "insensitive" } },
            ...(search.phone
              ? [
                  {
                    phoneNormalized: { contains: search.phone },
                  } satisfies Prisma.CustomerWhereInput,
                ]
              : []),
          ],
        }
      : undefined;
    const customers = await this.prisma.customer.findMany({
      where: tenantWhere(tenant, {
        archivedAt: null,
        ...(cursorCondition ? { AND: [cursorCondition] } : {}),
        ...(searchCondition ? { OR: searchCondition.OR } : {}),
      }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
    });

    return { customers: customers.slice(0, PAGE_SIZE), hasMore: customers.length > PAGE_SIZE };
  }

  findActiveById(
    tenant: Pick<TenantContext, "shopId">,
    customerId: string,
  ): Promise<Customer | null> {
    return this.prisma.customer.findFirst({
      where: tenantWhere(tenant, { id: customerId, archivedAt: null }),
    });
  }

  create(
    transaction: Prisma.TransactionClient,
    tenant: Pick<TenantContext, "shopId">,
    data: CustomerCreateData,
  ): Promise<Customer> {
    return transaction.customer.create({ data: { shopId: tenant.shopId, ...data } });
  }
}
