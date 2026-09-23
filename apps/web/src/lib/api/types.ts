export type MembershipRole = "OWNER" | "RECEPTIONIST" | "TECHNICIAN";
export type MembershipStatus = "INVITED" | "ACTIVE" | "INACTIVE";

export interface BranchSummary {
  id: string;
  name: string;
}

export interface Membership {
  shopId: string;
  shopName: string;
  role: MembershipRole;
  status: MembershipStatus;
  timezone: string;
  intakePhotoMinimum: number;
  branches: BranchSummary[];
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  memberships: Membership[];
}

export interface AuthData {
  accessToken: string;
  expiresInSeconds: number;
  user: CurrentUser;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterOwnerInput {
  email: string;
  password: string;
  displayName: string;
  shopName: string;
  branchName: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  createdAt: string;
}

export type DeviceType = "PHONE" | "LAPTOP" | "TABLET" | "OTHER";

export interface Device {
  id: string;
  customerId: string;
  type: DeviceType;
  brand: string;
  model: string;
  color: string | null;
  serialMasked: string | null;
  imeiMasked: string | null;
}

export interface NewCustomer {
  name: string;
  phone: string;
  email?: string | null;
}

export interface NewDevice {
  type: DeviceType;
  brand: string;
  model: string;
  color?: string | null;
  serial?: string | null;
  imei?: string | null;
}

export type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type RepairOrderStatus =
  | "RECEIVED"
  | "DIAGNOSING"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "WAITING_PARTS"
  | "REPAIRING"
  | "QUALITY_CHECK"
  | "READY_FOR_PICKUP"
  | "COMPLETED"
  | "VOIDED";

export type CompletionOutcome =
  "REPAIRED" | "DECLINED_QUOTE" | "UNREPAIRABLE" | "NO_FAULT_FOUND" | "CUSTOMER_CANCELLED";

export interface IntakeAccessory {
  name: string;
  conditionNote?: string | null;
}

export interface CreateRepairOrderInput {
  branchId: string;
  customerId: string;
  deviceId: string;
  reportedProblem: string;
  intakeCondition: string;
  consentAcknowledged: true;
  priority: Priority;
  promisedAt?: string | null;
  accessories: IntakeAccessory[];
  mediaAssetIds: string[];
}

export interface RepairOrderReceipt {
  id: string;
  code: string;
  status: "RECEIVED";
  priority: Priority;
  branchId: string;
  reportedProblem: string;
  intakeCondition: string;
  customer: Customer;
  device: Device;
  promisedAt: string | null;
  receivedAt: string;
}

export interface RepairOrderSummary {
  id: string;
  code: string;
  status: RepairOrderStatus;
  completionOutcome: CompletionOutcome | null;
  priority: Priority;
  branchId: string;
  reportedProblem: string;
  intakeCondition: string;
  assignedTechnicianUserId: string | null;
  customer: Customer;
  device: Device;
  promisedAt: string | null;
  receivedAt: string;
  readyAt: string | null;
  returnedAt: string | null;
  lockVersion: number;
}

export interface IntakeAccessoryView {
  id: string;
  name: string;
  conditionNote: string | null;
}

export interface IntakeMediaView {
  id: string;
  purpose: "INTAKE" | "DIAGNOSIS" | "REPAIR" | "QC" | "HANDOVER" | "SIGNATURE";
  originalName: string;
  mimeType: string;
  byteSize: number;
  uploadedAt: string | null;
}

export interface RepairOrderTimelineEvent {
  id: string;
  eventType: string;
  fromStatus: RepairOrderStatus | null;
  toStatus: RepairOrderStatus | null;
  actorType: "USER" | "CUSTOMER_TOKEN" | "SYSTEM";
  publicPayload: unknown | null;
  createdAt: string;
}

export interface Assignment {
  id: string;
  repairOrderId: string;
  technicianUserId: string;
  technicianDisplayName: string;
  assignedByUserId: string;
  assignedAt: string;
  unassignedAt: string | null;
}

export interface ActiveTechnician {
  userId: string;
  displayName: string;
}

export interface Diagnosis {
  id: string;
  repairOrderId: string;
  revisionNo: number;
  finding: string;
  recommendation: string;
  supersedesId: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface CreateDiagnosisInput {
  finding: string;
  recommendation: string;
  supersedesId?: string | null;
}

export type QuoteItemKind = "SERVICE" | "PART" | "FEE";
export type QuoteQuantityUnit = "EACH" | "HOUR";

export type QuoteStatus =
  "DRAFT" | "SENT" | "ACCEPTED" | "PARTIALLY_ACCEPTED" | "DECLINED" | "EXPIRED" | "SUPERSEDED";

export interface QuoteItem {
  id: string;
  scopeKey: string;
  carriedFromQuoteItemId: string | null;
  kind: QuoteItemKind;
  description: string;
  displayNote: string | null;
  quantity: number;
  quantityUnit: QuoteQuantityUnit;
  unitPrice: number;
  lineTotal: number;
  isOptional: boolean;
  approvalGroup: string | null;
}

export interface Quote {
  id: string;
  repairOrderId: string;
  diagnosisId: string | null;
  versionNo: number;
  status: QuoteStatus;
  currency: "VND";
  items: QuoteItem[];
  subtotal: number;
  discount: number;
  total: number;
  customerNote: string | null;
  expiresAt: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQuoteItemInput {
  kind: QuoteItemKind;
  description: string;
  displayNote?: string | null;
  carriedFromQuoteItemId?: string | null;
  quantity: number;
  quantityUnit: QuoteQuantityUnit;
  unitPrice: number;
  isOptional: boolean;
  approvalGroup?: string | null;
}

export interface CreateQuoteInput {
  diagnosisId?: string | null;
  discount?: number;
  customerNote?: string | null;
  expiresAt?: string | null;
  items: CreateQuoteItemInput[];
}

export type QuoteSendChannel = "EMAIL" | "ZALO" | "SMS" | "COPY_LINK";

export interface SendQuoteResult {
  quote: Quote;
  publicUrl: string;
}

export interface ApprovedScopeItem {
  quoteItemId: string;
  scopeKey: string;
  kind: QuoteItemKind;
  description: string;
  displayNote: string | null;
  quantity: number;
  quantityUnit: QuoteQuantityUnit;
  unitPrice: number;
  lineTotal: number;
  isOptional: boolean;
  approvalGroup: string | null;
}

export interface ApprovedScopeSummary {
  quoteVersionId: string;
  decision: "ACCEPTED" | "PARTIALLY_ACCEPTED";
  approvedTotal: number;
  decidedAt: string;
  items: ApprovedScopeItem[];
}

export type WorkLogType = "REPAIR" | "TEST" | "CUSTOMER_CONTACT" | "INTERNAL_NOTE" | "CORRECTION";
export type WorkLogSemanticType = Exclude<WorkLogType, "CORRECTION">;

export interface WorkLog {
  id: string;
  repairOrderId: string;
  quoteItemId: string | null;
  scopeKey: string | null;
  type: WorkLogType;
  effectiveType: WorkLogSemanticType;
  content: string;
  supersedesId: string | null;
  isEffective: boolean;
  createdByUserId: string;
  createdAt: string;
}

export interface CreateWorkLogInput {
  type: WorkLogType;
  content: string;
  quoteItemId?: string | null;
  supersedesId?: string | null;
}

export type PartRequirementStatus = "NEEDED" | "ORDERED" | "AVAILABLE" | "CANCELLED";

export interface PartRequirement {
  id: string;
  repairOrderId: string;
  quoteItemId: string;
  scopeKey: string;
  nameSnapshot: string;
  sku: string | null;
  quantity: number;
  quantityUnit: QuoteQuantityUnit;
  status: PartRequirementStatus;
  lockVersion: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePartRequirementInput {
  quoteItemId: string;
  sku?: string | null;
}

export interface UpdatePartRequirementInput {
  targetStatus: "ORDERED" | "AVAILABLE";
  expectedLockVersion: number;
}

export interface PartUsed {
  id: string;
  repairOrderId: string;
  quoteItemId: string;
  scopeKey: string;
  supersedesId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  unitCost: number | null;
  unitSalePrice: number | null;
  isEffective: boolean;
  createdByUserId: string;
  createdAt: string;
}

export interface CreatePartUsedInput {
  quoteItemId: string;
  name: string;
  sku?: string | null;
  quantity: number;
  unitCost?: number | null;
  unitSalePrice?: number | null;
  supersedesId?: string | null;
}

export interface RepairOrderDetail extends RepairOrderSummary {
  accessories: IntakeAccessoryView[];
  media: IntakeMediaView[];
  activeAssignment: Assignment | null;
  diagnoses: Diagnosis[];
  quoteVersions: Quote[];
  approvedScope: ApprovedScopeSummary | null;
  workLogs: WorkLog[];
  partRequirements: PartRequirement[];
  partsUsed: PartUsed[];
  timeline: RepairOrderTimelineEvent[];
}

export type QuoteDecision = "ACCEPTED" | "PARTIALLY_ACCEPTED" | "DECLINED";

export interface PublicQuoteItem {
  id: string;
  kind: QuoteItemKind;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  isOptional: boolean;
  approvalGroup: string | null;
}

export interface PublicQuote {
  id: string;
  versionNo: number;
  status: Exclude<QuoteStatus, "DRAFT" | "EXPIRED" | "SUPERSEDED">;
  currency: "VND";
  items: PublicQuoteItem[];
  subtotal: number;
  discount: number;
  total: number;
  customerNote: string | null;
  expiresAt: string;
  sentAt: string;
  decidedAt: string | null;
}

export interface PublicTimelineEvent {
  type: string;
  message: string;
  createdAt: string;
}

export interface PublicOrder {
  shopName: string;
  shopContact: string | null;
  orderCode: string;
  deviceLabel: string;
  status: RepairOrderStatus;
  completionOutcome: CompletionOutcome | null;
  timeline: PublicTimelineEvent[];
  quote: PublicQuote | null;
}

export interface QuoteDecisionInput {
  decision: QuoteDecision;
  approvedItemIds?: string[];
  customerNote?: string | null;
}

export interface QuoteDecisionResult {
  quoteVersionId: string;
  decision: QuoteDecision;
  approvedTotal: number;
  decidedAt: string;
}

export interface RepairOrderFilters {
  query?: string;
  statuses?: RepairOrderStatus[];
  branchId?: string;
  technicianUserId?: string;
}

export interface RepairOrderPage {
  data: RepairOrderSummary[];
  meta: { nextCursor: string | null };
}

export interface ApiErrorDetail {
  field?: string;
  code: string;
  message?: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: ApiErrorDetail[];
  };
}
