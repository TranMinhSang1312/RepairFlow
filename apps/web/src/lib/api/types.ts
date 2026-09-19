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
