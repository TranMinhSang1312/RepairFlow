import type { Customer, Device, Priority, RepairOrderStatus } from "@prisma/client";

import { toCustomerView, type CustomerView } from "../customers/customer.types.js";
import { toDeviceView, type DeviceView } from "../devices/device.types.js";

export interface RepairOrderView {
  id: string;
  code: string;
  status: RepairOrderStatus;
  completionOutcome: null;
  priority: Priority;
  branchId: string;
  reportedProblem: string;
  intakeCondition: string;
  assignedTechnicianUserId: null;
  customer: CustomerView;
  device: DeviceView;
  receivedAt: string;
  readyAt: null;
  returnedAt: null;
  lockVersion: number;
}

export interface RepairOrderResponse {
  data: RepairOrderView;
}

interface CreatedRepairOrder {
  id: string;
  code: string;
  status: RepairOrderStatus;
  priority: Priority;
  branchId: string;
  reportedProblem: string;
  intakeCondition: string;
  receivedAt: Date;
  lockVersion: number;
  customer: Customer;
  device: Device;
}

export function toRepairOrderView(order: CreatedRepairOrder): RepairOrderView {
  return {
    id: order.id,
    code: order.code,
    status: order.status,
    completionOutcome: null,
    priority: order.priority,
    branchId: order.branchId,
    reportedProblem: order.reportedProblem,
    intakeCondition: order.intakeCondition,
    assignedTechnicianUserId: null,
    customer: toCustomerView(order.customer),
    device: toDeviceView(order.device),
    receivedAt: order.receivedAt.toISOString(),
    readyAt: null,
    returnedAt: null,
    lockVersion: order.lockVersion,
  };
}
