import type {
  ActorType,
  CompletionOutcome,
  Customer,
  Device,
  MediaPurpose,
  PartRequirement,
  PartUsed,
  Prisma,
  Priority,
  QuoteDecision,
  RepairOrderStatus,
} from "@prisma/client";

import { toCustomerView, type CustomerView } from "../customers/customer.types.js";
import { toDeviceView, type DeviceView } from "../devices/device.types.js";
import {
  toAssignmentView,
  type AssignmentRecord,
  type AssignmentView,
} from "./assignments/assignment.types.js";
import { toDiagnosisView, type DiagnosisView } from "../diagnoses/diagnosis.types.js";
import { toQuoteView, type QuoteRecord, type QuoteView } from "../quotes/quote.types.js";
import {
  parseApprovedScope,
  toPartRequirementView,
  toPartUsedViews,
  toWorkLogViews,
  type ApprovedScopeSummary,
  type PartRequirementView,
  type PartUsedView,
  type WorkLogRecord,
  type WorkLogView,
} from "../service-execution/service-execution.types.js";

export interface RepairOrderView {
  id: string;
  code: string;
  status: RepairOrderStatus;
  completionOutcome: CompletionOutcome | null;
  priority: Priority;
  branchId: string;
  reportedProblem: string;
  intakeCondition: string;
  assignedTechnicianUserId: string | null;
  customer: CustomerView;
  device: DeviceView;
  promisedAt: string | null;
  receivedAt: string;
  readyAt: string | null;
  returnedAt: string | null;
  lockVersion: number;
}

export interface RepairOrderResponse {
  data: RepairOrderView;
}

export interface RepairOrderListResponse {
  data: RepairOrderView[];
  meta: { nextCursor: string | null };
}

export interface IntakeAccessoryView {
  id: string;
  name: string;
  conditionNote: string | null;
}

export interface IntakeMediaView {
  id: string;
  purpose: MediaPurpose;
  originalName: string;
  mimeType: string;
  byteSize: number;
  uploadedAt: string | null;
}

export interface OrderEventView {
  id: string;
  eventType: string;
  fromStatus: RepairOrderStatus | null;
  toStatus: RepairOrderStatus | null;
  actorType: ActorType;
  publicPayload: Prisma.JsonValue | null;
  createdAt: string;
}

export interface RepairOrderDetailView extends RepairOrderView {
  accessories: IntakeAccessoryView[];
  media: IntakeMediaView[];
  activeAssignment: AssignmentView | null;
  diagnoses: DiagnosisView[];
  quoteVersions: QuoteView[];
  approvedScope: ApprovedScopeSummary | null;
  workLogs: WorkLogView[];
  partRequirements: PartRequirementView[];
  partsUsed: PartUsedView[];
  timeline: OrderEventView[];
}

export interface RepairOrderDetailResponse {
  data: RepairOrderDetailView;
}

interface RepairOrderRecord {
  id: string;
  code: string;
  status: RepairOrderStatus;
  completionOutcome: CompletionOutcome | null;
  priority: Priority;
  branchId: string;
  reportedProblem: string;
  intakeCondition: string;
  customerSnapshot: Prisma.JsonValue;
  deviceSnapshot: Prisma.JsonValue;
  promisedAt: Date | null;
  receivedAt: Date;
  readyAt: Date | null;
  returnedAt: Date | null;
  lockVersion: number;
  customer: Customer;
  device: Device;
  assignments?: AssignmentRecord[];
}

function jsonRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function stringValue(value: Prisma.JsonValue | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(
  value: Prisma.JsonValue | undefined,
  fallback: string | null,
): string | null {
  return value === null || typeof value === "string" ? value : fallback;
}

function masked(value: string | null): string | null {
  return value ? `••••${value.slice(-4)}` : null;
}

export function toRepairOrderView(order: RepairOrderRecord): RepairOrderView {
  const customerSnapshot = jsonRecord(order.customerSnapshot);
  const deviceSnapshot = jsonRecord(order.deviceSnapshot);
  const customer = toCustomerView(order.customer);
  const device = toDeviceView(order.device);

  return {
    id: order.id,
    code: order.code,
    status: order.status,
    completionOutcome: order.completionOutcome,
    priority: order.priority,
    branchId: order.branchId,
    reportedProblem: order.reportedProblem,
    intakeCondition: order.intakeCondition,
    assignedTechnicianUserId: order.assignments?.[0]?.technicianUserId ?? null,
    customer: {
      ...customer,
      name: stringValue(customerSnapshot.name, customer.name),
      phone: stringValue(customerSnapshot.phone, customer.phone),
      email: nullableString(customerSnapshot.email, customer.email),
      notes: null,
    },
    device: {
      ...device,
      type: stringValue(deviceSnapshot.type, device.type) as Device["type"],
      brand: stringValue(deviceSnapshot.brand, device.brand),
      model: stringValue(deviceSnapshot.model, device.model),
      color: nullableString(deviceSnapshot.color, device.color),
      serialMasked: masked(nullableString(deviceSnapshot.serial, null)),
      imeiMasked: masked(nullableString(deviceSnapshot.imei, null)),
    },
    promisedAt: order.promisedAt?.toISOString() ?? null,
    receivedAt: order.receivedAt.toISOString(),
    readyAt: order.readyAt?.toISOString() ?? null,
    returnedAt: order.returnedAt?.toISOString() ?? null,
    lockVersion: order.lockVersion,
  };
}

export function toRepairOrderDetailView(
  order: RepairOrderRecord & {
    accessories: Array<{ id: string; name: string; conditionNote: string | null }>;
    media: Array<{
      id: string;
      purpose: MediaPurpose;
      originalName: string;
      mimeType: string;
      byteSize: number;
      uploadedAt: Date | null;
    }>;
    events: Array<{
      id: string;
      eventType: string;
      fromStatus: RepairOrderStatus | null;
      toStatus: RepairOrderStatus | null;
      actorType: ActorType;
      publicPayload: Prisma.JsonValue | null;
      createdAt: Date;
    }>;
    diagnoses: Parameters<typeof toDiagnosisView>[0][];
    quoteVersions: Array<
      QuoteRecord & {
        approval: {
          decision: QuoteDecision;
          approvedItemSnapshot: Prisma.JsonValue;
          approvedTotal: bigint;
          decidedAt: Date;
        } | null;
      }
    >;
    workLogs: WorkLogRecord[];
    partRequirements: PartRequirement[];
    partsUsed: PartUsed[];
  },
): RepairOrderDetailView {
  const binding = [...order.quoteVersions]
    .reverse()
    .find(
      (quote) =>
        quote.approval && (quote.status === "ACCEPTED" || quote.status === "PARTIALLY_ACCEPTED"),
    );
  return {
    ...toRepairOrderView(order),
    accessories: order.accessories,
    media: order.media.map((asset) => ({
      ...asset,
      uploadedAt: asset.uploadedAt?.toISOString() ?? null,
    })),
    activeAssignment: order.assignments?.[0] ? toAssignmentView(order.assignments[0]) : null,
    diagnoses: order.diagnoses.map(toDiagnosisView),
    quoteVersions: order.quoteVersions.map(toQuoteView),
    approvedScope: parseApprovedScope(binding),
    workLogs: toWorkLogViews(order.workLogs),
    partRequirements: order.partRequirements.map(toPartRequirementView),
    partsUsed: toPartUsedViews(order.partsUsed),
    timeline: order.events.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
