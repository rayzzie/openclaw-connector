import { describe, expect, it } from "vitest";

import { acquireRuntimeStart } from "../src/runtime-start-guard.js";

describe("runtime start guard", () => {
  it("allows only one active connector per key in a process", () => {
    const key = "http://gateway|agent_001";
    const first = acquireRuntimeStart(key);
    const second = acquireRuntimeStart(key);

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);

    first.release();
    const third = acquireRuntimeStart(key);
    expect(third.acquired).toBe(true);
    third.release();
  });

  it("allows different agents to start independently", () => {
    const first = acquireRuntimeStart("http://gateway|agent_001");
    const second = acquireRuntimeStart("http://gateway|agent_002");

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(true);

    first.release();
    second.release();
  });
});
