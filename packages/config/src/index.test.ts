import { describe, expect, it } from "vitest";

import { parseApiEnvironment, parseWebEnvironment } from "./index.js";

describe("environment parsing", () => {
  it("applies safe local defaults", () => {
    const api = parseApiEnvironment({ DATABASE_URL: "postgresql://localhost/repairflow" });
    const web = parseWebEnvironment({});

    expect(api.API_PORT).toBe(3001);
    expect(api.LOG_LEVEL).toBe("info");
    expect(web.NEXT_PUBLIC_API_URL).toBe("http://localhost:3001/api/v1");
  });

  it("rejects a missing database URL", () => {
    expect(() => parseApiEnvironment({})).toThrow();
  });
});
