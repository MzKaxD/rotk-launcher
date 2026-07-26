import { isValidLaunchTicket } from "../../shared/launch-ticket.js";
import { isValidPlayerKey, normalizePlayerKey } from "../../shared/player-key.js";

const DEFAULT_TIMEOUT_MS = 8_000;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STEAM_ID_PATTERN = /^\d{17}$/;
const DECIMAL_ID_PATTERN = /^[1-9]\d{0,18}$/;
const MAX_SIGNED_63_BIT = 9_223_372_036_854_775_807n;
const MINIMUM_TICKET_LIFETIME_MS = 10_000;
const MAXIMUM_SERVER_TICKET_LIFETIME_MS = 10 * 60_000;

export interface LaunchTicketIdentity {
  readonly ticket: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  /** Monotonic receipt time; never derived from the workstation wall clock. */
  readonly receivedAtMonotonicMs: number;
  /** Conservative remaining lifetime at receipt, based on authority timestamps. */
  readonly initialRemainingLifetimeMs: number;
  readonly rotkId: string;
  readonly gameAccountGuid: string;
  readonly steamId: string;
  readonly displayName: string;
}

interface TicketRequestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function validateEndpoint(value: string): URL {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "https:"
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
  ) {
    throw new Error("Invalid ROTK launch ticket endpoint");
  }
  return endpoint;
}

export function assertLaunchTicketFresh(
  identity: Pick<
    LaunchTicketIdentity,
    "receivedAtMonotonicMs" | "initialRemainingLifetimeMs"
  >,
  minimumLifetimeMs = MINIMUM_TICKET_LIFETIME_MS,
  nowMonotonicMs = performance.now(),
): void {
  if (
    !Number.isFinite(minimumLifetimeMs)
    || minimumLifetimeMs < 0
    || minimumLifetimeMs > MAXIMUM_SERVER_TICKET_LIFETIME_MS
    || !Number.isFinite(nowMonotonicMs)
    || !Number.isFinite(identity.receivedAtMonotonicMs)
    || !Number.isFinite(identity.initialRemainingLifetimeMs)
    || identity.initialRemainingLifetimeMs <= 0
    || identity.initialRemainingLifetimeMs > MAXIMUM_SERVER_TICKET_LIFETIME_MS
  ) {
    throw new Error("Invalid ROTK launch ticket freshness check");
  }
  const elapsedSinceReceiptMs = Math.max(
    0,
    nowMonotonicMs - identity.receivedAtMonotonicMs,
  );
  if (identity.initialRemainingLifetimeMs - elapsedSinceReceiptMs <= minimumLifetimeMs) {
    throw new Error("The ROTK launch ticket expires too soon");
  }
}

function parseCanonicalAuthorityTimestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : Number.NaN;
}

interface TicketResponseTiming {
  readonly requestStartedAtMonotonicMs: number;
  readonly receivedAtMonotonicMs: number;
}

function parseTicketResponse(
  value: unknown,
  timing: TicketResponseTiming = {
    requestStartedAtMonotonicMs: performance.now(),
    receivedAtMonotonicMs: performance.now(),
  },
): LaunchTicketIdentity {
  if (!value || typeof value !== "object") throw new Error("Invalid response from the ROTK account service");
  const response = value as Record<string, unknown>;
  const issuedAt = typeof response.issuedAt === "string" ? response.issuedAt : "";
  const expiresAt = typeof response.expiresAt === "string" ? response.expiresAt : "";
  const displayName = typeof response.displayName === "string" ? response.displayName.trim() : "";
  const gameAccountGuid = typeof response.gameAccountGuid === "string" ? response.gameAccountGuid : "";
  const issuedAtMs = parseCanonicalAuthorityTimestamp(issuedAt);
  const expiresAtMs = parseCanonicalAuthorityTimestamp(expiresAt);
  const requestElapsedMs = timing.receivedAtMonotonicMs - timing.requestStartedAtMonotonicMs;
  const serverTicketLifetimeMs = expiresAtMs - issuedAtMs;
  if (
    response.ok !== true
    || !isValidLaunchTicket(response.ticket)
    || !UUID_V4_PATTERN.test(typeof response.rotkId === "string" ? response.rotkId : "")
    || !DECIMAL_ID_PATTERN.test(gameAccountGuid)
    || BigInt(gameAccountGuid) > MAX_SIGNED_63_BIT
    || !STEAM_ID_PATTERN.test(typeof response.steamId === "string" ? response.steamId : "")
    || displayName.length < 1
    || displayName.length > 32
    || /[\u0000-\u001f\u007f]/u.test(displayName)
    || !Number.isFinite(issuedAtMs)
    || !Number.isFinite(expiresAtMs)
    || !Number.isFinite(timing.requestStartedAtMonotonicMs)
    || !Number.isFinite(timing.receivedAtMonotonicMs)
    || requestElapsedMs < 0
    || serverTicketLifetimeMs <= 0
    || serverTicketLifetimeMs > MAXIMUM_SERVER_TICKET_LIFETIME_MS
  ) {
    throw new Error("Invalid response from the ROTK account service");
  }
  // The authority-issued interval is independent from the workstation clock.
  // Subtracting the complete HTTPS round trip is deliberately conservative:
  // issuance happens during that interval, never before it. The game server
  // still enforces expiry, one-time consumption and account binding.
  const identity: LaunchTicketIdentity = Object.freeze({
    ticket: response.ticket,
    issuedAt,
    expiresAt,
    receivedAtMonotonicMs: timing.receivedAtMonotonicMs,
    initialRemainingLifetimeMs: serverTicketLifetimeMs - requestElapsedMs,
    rotkId: response.rotkId as string,
    gameAccountGuid,
    steamId: response.steamId as string,
    displayName,
  });
  assertLaunchTicketFresh(identity, MINIMUM_TICKET_LIFETIME_MS, timing.receivedAtMonotonicMs);
  return identity;
}
function serviceError(status: number, value: unknown): Error {
  const errorCode = value && typeof value === "object"
    ? (value as Record<string, unknown>).error
    : null;
  if (status === 401 || errorCode === "invalid_credentials") {
    return new Error("The ROTK launcher key was rejected");
  }
  if (status === 429 || errorCode === "rate_limited") {
    return new Error("Too many ROTK authentication attempts. Wait a moment and try again");
  }
  if (status === 503 || errorCode === "service_unavailable") {
    return new Error("The ROTK account service is temporarily unavailable");
  }
  return new Error("The ROTK account service refused the launch request");
}

export async function createLaunchTicket(
  playerKey: unknown,
  endpointValue: string,
  options: TicketRequestOptions = {},
): Promise<LaunchTicketIdentity> {
  if (!isValidPlayerKey(playerKey)) throw new Error("Invalid ROTK player key");
  const endpoint = validateEndpoint(endpointValue);
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestStartedAtMonotonicMs = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ launcherKey: normalizePlayerKey(playerKey) }),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new Error("Unable to reach the ROTK account service");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Invalid response from the ROTK account service");
    }
    if (!response.ok) throw serviceError(response.status, payload);
    return parseTicketResponse(payload, {
      requestStartedAtMonotonicMs,
      receivedAtMonotonicMs: performance.now(),
    });
  } finally {
    clearTimeout(timeout);
  }
}

export const launchTicketInternals = {
  parseTicketResponse,
  validateEndpoint,
};
