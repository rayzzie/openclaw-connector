import { describe, it, expect, beforeEach } from "vitest";
import { setRuntime, getRuntime } from "../src/plugin-runtime.js";

describe("plugin runtime store", () => {
  beforeEach(() => {
    setRuntime(undefined);
  });

  it("returns undefined before set", () => {
    expect(getRuntime()).toBeUndefined();
  });

  it("returns runtime after set", () => {
    const fakeRt = { channel: {} } as never;
    setRuntime(fakeRt);
    expect(getRuntime()).toBe(fakeRt);
  });

  it("returns undefined after clearing", () => {
    setRuntime({ channel: {} } as never);
    setRuntime(undefined);
    expect(getRuntime()).toBeUndefined();
  });
});
