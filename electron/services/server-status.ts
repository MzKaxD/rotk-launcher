import type { RuntimeConfig } from "./runtime-config.js";

const DEFAULT_TIMEOUT_MS = 5_000;
/**
 * A launcher left open all evening must not become a scraper. The server caches
 * its own sample for seconds, so a minute here is already finer than the number
 * moves in practice.
 */
export const SERVER_STATUS_POLL_INTERVAL_MS = 60_000;
/** Refuses an absurd count rather than rendering it as if it were real. */
const MAX_PLAYERS = 100_000;

export interface ServerStatus {
  /** Humans in game, or null when the server could not tell us. */
  readonly players: number | null;
  readonly capacity: number | null;
  readonly online: boolean;
}

export const UNKNOWN_SERVER_STATUS: ServerStatus = Object.freeze({
  players: null,
  capacity: null,
  online: false,
});

function count(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_PLAYERS
    ? value
    : null;
}

export function parseServerStatus(value: unknown): ServerStatus {
  if (!value || typeof value !== "object") throw new Error("Invalid ROTK server status");
  const payload = value as Record<string, unknown>;
  if (typeof payload.online !== "boolean") throw new Error("Invalid ROTK server status");
  const players = count(payload.players);
  return {
    players,
    capacity: count(payload.capacity),
    // A server that claims to be online without a usable count is reported as
    // unknown: a missing number must not render as an empty, confident "0".
    online: payload.online && players !== null,
  };
}

export function statusEndpoint(runtime: RuntimeConfig): URL {
  const endpoint = new URL("/api/status", runtime.websiteOrigin);
  if (endpoint.protocol !== "https:" || endpoint.origin !== runtime.websiteOrigin) {
    throw new Error("Invalid ROTK server status endpoint");
  }
  return endpoint;
}

/**
 * Reads one server's public population. Never throws: an unreachable or
 * unparsable server is "unknown", which is what the footer shows, and is not a
 * reason to surface an error banner over a launcher that otherwise works.
 */
export async function fetchServerStatus(
  runtime: RuntimeConfig,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ServerStatus> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(statusEndpoint(runtime), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return UNKNOWN_SERVER_STATUS;
    return parseServerStatus(await response.json());
  } catch {
    return UNKNOWN_SERVER_STATUS;
  } finally {
    clearTimeout(timeout);
  }
}
