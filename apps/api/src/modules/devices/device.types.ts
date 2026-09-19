import type { Device } from "@prisma/client";

export interface DeviceView {
  id: string;
  customerId: string;
  type: Device["type"];
  brand: string;
  model: string;
  color: string | null;
  serialMasked: string | null;
  imeiMasked: string | null;
}

export interface DeviceResponse {
  data: DeviceView;
}

function masked(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return `••••${value.slice(-4)}`;
}

export function toDeviceView(device: Device): DeviceView {
  return {
    id: device.id,
    customerId: device.customerId,
    type: device.type,
    brand: device.brand,
    model: device.model,
    color: device.color,
    serialMasked: masked(device.serialNormalized),
    imeiMasked: masked(device.imeiNormalized),
  };
}
