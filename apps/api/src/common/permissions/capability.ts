import { MembershipRole } from "@prisma/client";

export const Capability = {
  CUSTOMER_LIST: "CUSTOMER_LIST",
  CUSTOMER_WRITE: "CUSTOMER_WRITE",
  DEVICE_LIST: "DEVICE_LIST",
  DEVICE_WRITE: "DEVICE_WRITE",
  INTAKE_CREATE: "INTAKE_CREATE",
  INTAKE_MEDIA_UPLOAD: "INTAKE_MEDIA_UPLOAD",
  REPAIR_ORDER_LIST: "REPAIR_ORDER_LIST",
  REPAIR_ORDER_READ_ASSIGNED: "REPAIR_ORDER_READ_ASSIGNED",
  ASSIGNMENT_MANAGE: "ASSIGNMENT_MANAGE",
  REPAIR_ORDER_TRANSITION: "REPAIR_ORDER_TRANSITION",
  DIAGNOSIS_CREATE: "DIAGNOSIS_CREATE",
  QUOTE_DRAFT_WRITE: "QUOTE_DRAFT_WRITE",
} as const;

export type Capability = (typeof Capability)[keyof typeof Capability];

const allCapabilities = new Set<Capability>(Object.values(Capability));

export const ROLE_CAPABILITIES: Readonly<Record<MembershipRole, ReadonlySet<Capability>>> = {
  [MembershipRole.OWNER]: allCapabilities,
  [MembershipRole.RECEPTIONIST]: allCapabilities,
  [MembershipRole.TECHNICIAN]: new Set([
    Capability.REPAIR_ORDER_READ_ASSIGNED,
    Capability.REPAIR_ORDER_TRANSITION,
    Capability.DIAGNOSIS_CREATE,
  ]),
};
