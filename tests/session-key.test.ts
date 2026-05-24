import { describe, it, expect } from "vitest";
import { buildSessionKey } from "../src/session-key.js";

describe("buildSessionKey", () => {
  it("produces expected format", () => {
    expect(buildSessionKey("+8613800138000")).toBe("uniagentgate:phone:+8613800138000");
  });

  it("works with different phone formats", () => {
    expect(buildSessionKey("13800138000")).toBe("uniagentgate:phone:13800138000");
  });
});
