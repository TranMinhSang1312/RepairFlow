import { describe, expect, it } from "vitest";

import type { Customer, Device } from "../api/types";
import { EMPTY_INTAKE_DRAFT, toIsoDateTime, validateIntakeDraft } from "./intake-form";

const customer: Customer = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Nguyen Van An",
  phone: "0900000000",
  email: null,
  notes: null,
  createdAt: "2026-09-19T00:00:00.000Z",
};

const device: Device = {
  id: "22222222-2222-4222-8222-222222222222",
  customerId: customer.id,
  type: "PHONE",
  brand: "Apple",
  model: "iPhone 15",
  color: "Black",
  serialMasked: null,
  imeiMasked: "••••1234",
};

describe("intake form validation", () => {
  it("blocks custody creation until the required evidence is present", () => {
    expect(validateIntakeDraft(EMPTY_INTAKE_DRAFT)).toMatchObject({
      branchId: expect.any(String),
      customer: expect.any(String),
      device: expect.any(String),
      reportedProblem: expect.any(String),
      intakeCondition: expect.any(String),
      consentAcknowledged: expect.any(String),
      uploadedMediaIds: expect.any(String),
    });
  });

  it("accepts a complete draft and validates structured accessories", () => {
    const complete = {
      ...EMPTY_INTAKE_DRAFT,
      branchId: "33333333-3333-4333-8333-333333333333",
      customer,
      device,
      reportedProblem: "May khong len nguon",
      intakeCondition: "Xuoc nhe goc trai",
      consentAcknowledged: true,
      uploadedMediaIds: ["44444444-4444-4444-8444-444444444444"],
      accessories: [{ name: "Sac", conditionNote: "Hoat dong binh thuong" }],
    };

    expect(validateIntakeDraft(complete)).toEqual({});
    expect(validateIntakeDraft({ ...complete, accessories: [{ name: "   " }] })).toHaveProperty(
      "accessories.0.name",
    );
    expect(validateIntakeDraft(complete, 2)).toHaveProperty("uploadedMediaIds");
  });

  it("converts a local promised date to the API UTC shape", () => {
    expect(toIsoDateTime("2026-09-20T10:30")).toMatch(/^2026-09-20T\d{2}:30:00\.000Z$/);
    expect(toIsoDateTime("")).toBeNull();
  });
});
