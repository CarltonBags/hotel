/**
 * Live updates: notification kinds starting with this prefix tell open
 * screens that data changed; they are not shown as toasts. Shared by the
 * events package (server) and the shell (browser).
 */
export const DATA_CHANGE_PREFIX = "data.";

export const DATA_KINDS = { reservations: "data.reservations" } as const;
export type DataKind = (typeof DATA_KINDS)[keyof typeof DATA_KINDS];

export function isDataChange(kind: string): boolean {
  return kind.startsWith(DATA_CHANGE_PREFIX);
}
