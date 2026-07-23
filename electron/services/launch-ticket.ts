import { isValidLaunchTicket } from "../../shared/launch-ticket.js";
import { isValidPlayerKey, normalizePlayerKey } from "../../shared/player-key.js";

const DEFAULT_TIMEOUT_MS = 8_000;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STEAM_ID_PATTERN = /^\d{17}$/;
const DECIMAL_ID_PATTERN = /^[1-9]\d{0,18}$/;
const MAX_SIGNED_63_BIT = 9_223_372_036_854_775_807n;
const MINIMUM_TICKET_LIFETIME_MS = 10_000;

export interface LaunchTicketIdentity {
  ticket: string;
  expiresAt: string;
  rotkId: string;
  gameAccountGuid: string;
  steamId: string;
  displayName: string;
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
  expiresAt: string,
  minimumLifetimeMs = MINIMUM_TICKET_LIFETIME_MS,
): void {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + minimumLifetimeMs) {
    throw new Error("The ROTK launch ticket expires too soon");
  }
}

function parseTicketResponse(value: unknown): LaunchTicketIdentity {
  if (!value || typeof value !== "object") throw new Error("Invalid response from the ROTK account service");
  const response = value as Record<string, unknown>;
  const expiresAt = typeof response.expiresAt === "string" ? response.expiresAt : "";
  const displayName = typeof response.displayName === "string" ? response.displayName.trim() : "";
  const gameAccountGuid = typeof response.gameAccountGuid === "string" ? response.gameAccountGuid : "";
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
  ) {
    throw new Error("Invalid response from the ROTK account service");
  }
  assertLaunchTicketFresh(expiresAt);
  return {
    ticket: response.ticket,
    expiresAt,
    rotkId: response.rotkId as string,
    gameAccountGuid,
    steamId: response.steamId as string,
    displayName,
  };
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
    return parseTicketResponse(payload);
  } finally {
    clearTimeout(timeout);
  }
}

export const launchTicketInternals = {
  parseTicketResponse,
  validateEndpoint,
};
