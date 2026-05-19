import { describe, expect, it } from "vitest";

import { SequenceGenerator } from "../src/sequence-generator.js";

describe("SequenceGenerator", () => {
  it("increments per request response stream", () => {
    const generator = new SequenceGenerator();

    expect(generator.next("req_1", "resp_1")).toBe(1);
    expect(generator.next("req_1", "resp_1")).toBe(2);
    expect(generator.next("req_1", "resp_2")).toBe(1);
  });
});
