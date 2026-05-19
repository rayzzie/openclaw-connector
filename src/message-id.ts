import { randomUUID } from "node:crypto";

export function newMessageId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
