/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs PrismaService at runtime. */

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infra/database/prisma.service.js";

@Injectable()
export class IntakeDraftRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMedia(
    shopId: string,
    mediaAssetId: string,
    transaction: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return transaction.mediaAsset.findFirst({ where: { shopId, id: mediaAssetId } });
  }
}
