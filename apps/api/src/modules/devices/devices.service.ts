/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, type Device } from "@prisma/client";

import { ApiException } from "../../common/api-exception.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { PrismaService } from "../../infra/database/prisma.service.js";
import { CustomersService } from "../customers/customers.service.js";
import type { CreateDeviceDto, UpdateDeviceDto } from "./device.dto.js";
import { type DeviceResponse, type DeviceView, toDeviceView } from "./device.types.js";
import { DevicesRepository } from "./devices.repository.js";

function normalizeOptional(value: string | null | undefined, pattern: RegExp): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.toUpperCase().replace(pattern, "");
  return normalized || null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL_PATTERN =
  /(?:pin|password|passcode|unlock(?:\s+code)?|mật khẩu|mat khau)\s*[:#=-]\s*\S+/iu;

export function normalizeSerial(value: string | null | undefined): string | null {
  return normalizeOptional(value, /[^A-Z0-9]/g);
}

export function normalizeImei(value: string | null | undefined): string | null {
  return normalizeOptional(value, /\D/g);
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly customersService: CustomersService,
    private readonly repository: DevicesRepository,
    private readonly prisma: PrismaService,
  ) {}

  async list(tenant: TenantContext, customerId: string): Promise<{ data: DeviceView[] }> {
    await this.customersService.requireActiveCustomer(tenant, customerId);
    const devices = await this.repository.listActive(tenant, customerId);
    return { data: devices.map(toDeviceView) };
  }

  async create(
    tenant: TenantContext,
    customerId: string,
    dto: CreateDeviceDto,
  ): Promise<DeviceResponse> {
    await this.customersService.requireActiveCustomer(tenant, customerId);
    this.assertSafeNotes(dto.notes);
    const device = await this.repository.create(tenant, {
      customerId,
      type: dto.type,
      brand: dto.brand,
      model: dto.model,
      color: dto.color ?? null,
      serialNormalized: normalizeSerial(dto.serial),
      imeiNormalized: normalizeImei(dto.imei),
      notes: dto.notes ?? null,
    });
    return { data: toDeviceView(device) };
  }

  async update(
    tenant: TenantContext,
    customerId: string,
    deviceId: string,
    dto: UpdateDeviceDto,
  ): Promise<DeviceResponse> {
    const customer = await this.customersService.requireActiveCustomer(tenant, customerId);
    const id = this.validatedId(deviceId);
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "VALIDATION_FAILED",
        "At least one change is required.",
      );
    }
    this.assertSafeNotes(dto.notes);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.device.findFirst({
        where: { id, shopId: tenant.shopId, customerId: customer.id, archivedAt: null },
      });
      if (!current) throw this.notFound();
      const updated = await tx.device.update({
        where: { id },
        data: {
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.brand !== undefined ? { brand: dto.brand } : {}),
          ...(dto.model !== undefined ? { model: dto.model } : {}),
          ...(dto.color !== undefined ? { color: dto.color || null } : {}),
          ...(dto.serial !== undefined ? { serialNormalized: normalizeSerial(dto.serial) } : {}),
          ...(dto.imei !== undefined ? { imeiNormalized: normalizeImei(dto.imei) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        },
      });
      await this.audit(tx, tenant, "device.updated", id, current, updated);
      return { data: toDeviceView(updated) };
    });
  }

  async archive(
    tenant: TenantContext,
    customerId: string,
    deviceId: string,
  ): Promise<DeviceResponse> {
    const customer = await this.customersService.requireActiveCustomer(tenant, customerId);
    const id = this.validatedId(deviceId);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.device.findFirst({
        where: { id, shopId: tenant.shopId, customerId: customer.id, archivedAt: null },
      });
      if (!current) throw this.notFound();
      const updated = await tx.device.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit(tx, tenant, "device.archived", id, current, updated);
      return { data: toDeviceView(updated) };
    });
  }

  private validatedId(value: string): string {
    if (!UUID_PATTERN.test(value)) throw this.notFound();
    return value.toLowerCase();
  }

  private assertSafeNotes(notes: string | null | undefined): void {
    if (!notes || !CREDENTIAL_PATTERN.test(notes)) return;
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "VALIDATION_FAILED",
      "One or more input fields are invalid.",
      [
        {
          field: "notes",
          code: "DEVICE_CREDENTIAL_NOT_ALLOWED",
          message: "Device unlock credentials must not be stored in notes.",
        },
      ],
    );
  }

  private audit(
    tx: Prisma.TransactionClient,
    tenant: TenantContext,
    action: string,
    entityId: string,
    before: Device,
    after: Device,
  ) {
    return tx.auditLog.create({
      data: {
        shopId: tenant.shopId,
        actorUserId: tenant.userId,
        action,
        entityType: "DEVICE",
        entityId,
        beforeData: this.auditView(before),
        afterData: this.auditView(after),
        requestId: tenant.requestId,
      },
    });
  }

  private auditView(device: Device) {
    return {
      customerId: device.customerId,
      type: device.type,
      brand: device.brand,
      model: device.model,
      color: device.color,
      serialLast4: device.serialNormalized?.slice(-4) ?? null,
      imeiLast4: device.imeiNormalized?.slice(-4) ?? null,
      notes: device.notes,
      archivedAt: device.archivedAt?.toISOString() ?? null,
    };
  }

  private notFound(): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
}
