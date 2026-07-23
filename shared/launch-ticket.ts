export const LAUNCH_TICKET_LENGTH = 43;

const LAUNCH_TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidLaunchTicket(value: unknown): value is string {
  return typeof value === "string" && LAUNCH_TICKET_PATTERN.test(value);
}
