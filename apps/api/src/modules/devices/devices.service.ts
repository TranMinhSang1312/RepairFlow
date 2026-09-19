/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs constructor tokens at runtime for DI. */

import { HttpStatus, Injectable } from "@nestjs/common";

import { ApiException } from "../../common/api-exception.js";
import type { TenantContext } from "../../common/tenant/tenant-context.js";
import { CustomersService } from "../customers/customers.service.js";
import type { CreateDeviceDto } from "./device.dto.js";
import { type DeviceResponse, type DeviceView, toDeviceView } from "./device.types.js";
import { DevicesRepository } from "./devices.repository.js";

function normalizeOptional(value: string | null | undefined, pattern: RegExp): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.toUpperCase().replace(pattern, "");
  return normalized || null;
}

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
    if (
      dto.notes &&
      /(?:pin|password|passcode|unlock(?:\s+code)?|mật khẩu|mat khau)\s*[:#=-]\s*\S+/iu.test(
        dto.notes,
      )
    ) {
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
}
