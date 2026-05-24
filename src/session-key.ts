export function buildSessionKey(phone: string): string {
  return `uniagentgate:phone:${phone}`;
}
