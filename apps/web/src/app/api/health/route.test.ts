import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("web health route", () => {
  it("returns an ok response", async () => {
    const response = GET();
    const body = (await response.json()) as { service: string; status: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ service: "web", status: "ok" });
  });
});
