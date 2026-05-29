import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REGISTRY_KEY = Symbol.for("uniagentgate.openclawConnectorRuntimeStarts");

type RuntimeStartRegistry = Set<string>;

export type RuntimeStartLease = {
  acquired: boolean;
  release: () => void;
};

export function acquireRuntimeStart(key: string): RuntimeStartLease {
  const registry = getRegistry();
  if (registry.has(key)) {
    return { acquired: false, release: () => undefined };
  }
  const lock = acquireProcessLock(key);
  if (!lock.acquired) {
    return { acquired: false, release: () => undefined };
  }
  registry.add(key);
  let released = false;
  return {
    acquired: true,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      registry.delete(key);
      lock.release();
    },
  };
}

function getRegistry(): RuntimeStartRegistry {
  const globalSymbols = globalThis as typeof globalThis & {
    [REGISTRY_KEY]?: RuntimeStartRegistry;
  };
  globalSymbols[REGISTRY_KEY] ??= new Set<string>();
  return globalSymbols[REGISTRY_KEY];
}

function acquireProcessLock(key: string): RuntimeStartLease {
  const lockDir = lockPath(key);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(lockDir, { mode: 0o700 });
      writeFileSync(join(lockDir, "pid"), String(process.pid), { mode: 0o600 });
      return {
        acquired: true,
        release: () => {
          rmSync(lockDir, { recursive: true, force: true });
        },
      };
    } catch (err) {
      if (!isObjectWithCode(err, "EEXIST")) {
        throw err;
      }
      if (isStaleLock(lockDir)) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      return { acquired: false, release: () => undefined };
    }
  }
  return { acquired: false, release: () => undefined };
}

function lockPath(key: string): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return join(tmpdir(), `uniagentgate-openclaw-runtime-${digest}.lock`);
}

function isStaleLock(lockDir: string): boolean {
  try {
    const pid = Number(readFileSync(join(lockDir, "pid"), "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) {
      return true;
    }
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return isObjectWithCode(err, "ESRCH") || isObjectWithCode(err, "ENOENT");
  }
}

function isObjectWithCode(value: unknown, code: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    (value as { code?: unknown }).code === code
  );
}
