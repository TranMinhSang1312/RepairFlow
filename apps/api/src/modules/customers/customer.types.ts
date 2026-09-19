import type { Customer } from "@prisma/client";

export interface CustomerView {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CustomerResponse {
  data: CustomerView;
}

export interface CustomerListResponse {
  data: CustomerView[];
  meta: { nextCursor: string | null };
}

export function toCustomerView(customer: Customer): CustomerView {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phoneRaw,
    email: customer.email,
    notes: customer.notes,
    createdAt: customer.createdAt.toISOString(),
  };
}
