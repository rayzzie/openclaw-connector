import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = join(process.cwd(), "scripts", "reinstall_openclaw_connector.sh");

describe("reinstall_openclaw_connector.sh", () => {
  it("updates OpenClaw config for the uniagentgate channel without deleting the source repo", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("plugins install --link");
    expect(script).toContain("--dangerously-force-unsafe-install");
    expect(script).toContain("UAG_OPENCLAW_INSTALL_ONLY=1");
    expect(script).toContain("channels.uniagentgate");
    expect(script).toContain("plugins.load.paths");
    expect(script).toContain("cp \"$CONFIG_PATH\"");
    expect(script).not.toContain("rm -rf \"$CONNECTOR_DIR\"");
  });
});
