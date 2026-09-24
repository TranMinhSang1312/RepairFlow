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
  QUOTE_SEND: "QUOTE_SEND",
  SERVICE_EXECUTION_WRITE: "SERVICE_EXECUTION_WRITE",
  QC_TEMPLATE_READ: "QC_TEMPLATE_READ",
  QC_TEMPLATE_MANAGE: "QC_TEMPLATE_MANAGE",
  QC_RUN_SUBMIT: "QC_RUN_SUBMIT",
  PAYMENT_CREATE: "PAYMENT_CREATE",
  HANDOVER_COMPLETE: "HANDOVER_COMPLETE",
} as const;

export type Capability = (typeof Capability)[keyof typeof Capability];

const allCapabilities = new Set<Capability>(Object.values(Capability));
const receptionistCapabilities = new Set<Capability>([
  Capability.CUSTOMER_LIST,
  Capability.CUSTOMER_WRITE,
  Capability.DEVICE_LIST,
  Capability.DEVICE_WRITE,
  Capability.INTAKE_CREATE,
  Capability.INTAKE_MEDIA_UPLOAD,
  Capability.REPAIR_ORDER_LIST,
  Capability.REPAIR_ORDER_READ_ASSIGNED,
  Capability.ASSIGNMENT_MANAGE,
  Capability.REPAIR_ORDER_TRANSITION,
  Capability.QUOTE_DRAFT_WRITE,
  Capability.QUOTE_SEND,
  Capability.QC_TEMPLATE_READ,
  Capability.PAYMENT_CREATE,
  Capability.HANDOVER_COMPLETE,
]);

export const ROLE_CAPABILITIES: Readonly<Record<MembershipRole, ReadonlySet<Capability>>> = {
  [MembershipRole.OWNER]: allCapabilities,
  [MembershipRole.RECEPTIONIST]: receptionistCapabilities,
  [MembershipRole.TECHNICIAN]: new Set([
    Capability.REPAIR_ORDER_READ_ASSIGNED,
    Capability.REPAIR_ORDER_TRANSITION,
    Capability.DIAGNOSIS_CREATE,
    Capability.SERVICE_EXECUTION_WRITE,
    Capability.QC_TEMPLATE_READ,
    Capability.QC_RUN_SUBMIT,
  ]),
};
