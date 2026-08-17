import { isValidPlayerKey, normalizePlayerKey } from "../../shared/player-key.js";
import type { OperatorConnection, OperatorIpBan } from "../../shared/contracts.js";
import type { RuntimeConfig } from "./runtime-config.js";

export const OPERATOR_SESSIONS_POLL_INTERVAL_MS = 20_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_REMOTE_ROWS = 200;

export type OperatorRemoteStatus = "idle" | "unavailable" | "forbidden" | "ok";
export type OperatorRemoteRole = "moderator" | "admin";

export interface OperatorRemoteFeed {
  status: OperatorRemoteStatus;
  role: OperatorRemoteRole | null;
  sessions: OperatorConnection[];
  bans: OperatorIpBan[];
  error: string | null;
  fetchedAt: string | null;
}

export const EMPTY_OPERATOR_REMOTE_FEED: OperatorRemoteFeed = Object.freeze({
  status: "idle",
  role: null,
  sessions: [],
  bans: [],
  error: null,
  fetchedAt: null,
});

export function operatorSessionsEndpoint(runtime: RuntimeConfig): URL {
  return operatorPath(runtime, "/api/launcher/operator/sessions");
}

export function operatorBansEndpoint(runtime: RuntimeConfig): URL {
  return operatorPath(runtime, "/api/launcher/operator/bans");
}

function operatorPath(runtime: RuntimeConfig, pathname: string): URL {
  const endpoint = new URL(pathname, runtime.websiteOrigin);
  if (
    endpoint.protocol !== "https:"
    || endpoint.origin !== runtime.websiteOrigin
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
  ) {
    throw new Error("Invalid ROTK operator endpoint");
  }
  return endpoint;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRole(value: unknown): OperatorRemoteRole | null {
  return value === "moderator" || value === "admin" ? value : null;
}

function parseSession(value: unknown): OperatorConnection | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const ip = asString(record.ip);
  if (!ip) return null;
  return {
    loginSessionId: asString(record.loginSessionId),
    name: asString(record.name),
    ip,
    at: asString(record.at),
  };
}

function parseBan(value: unknown): OperatorIpBan | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const ip = asString(record.ip) || asString(record.IP);
  if (!ip) return null;
  return {
    ip,
    reason: asString(record.reason) || asString(record.banReason),
    at: asString(record.at),
    active: record.active !== false,
  };
}

export function parseOperatorSessions(value: unknown): Omit<OperatorRemoteFeed, "fetchedAt"> {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid ROTK operator sessions response");
  }
  const payload = value as Record<string, unknown>;
  if (payload.ok === false) {
    throw new Error("The ROTK account service refused the operator request");
  }
  const sessions = Array.isArray(payload.sessions)
    ? payload.sessions.flatMap((entry) => {
      const parsed = parseSession(entry);
      return parsed ? [parsed] : [];
    }).slice(0, MAX_REMOTE_ROWS)
    : [];
  const bans = Array.isArray(payload.bans)
    ? payload.bans.flatMap((entry) => {
      const parsed = parseBan(entry);
      return parsed ? [parsed] : [];
    }).slice(0, MAX_REMOTE_ROWS)
    : [];
  return {
    status: "ok",
    role: asRole(payload.role),
    sessions,
    bans,
    error: null,
  };
}

async function postOperatorJson(
  endpoint: URL,
  body: Record<string, unknown>,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<{ status: number; payload: unknown }> {
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
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new Error("Unable to reach the ROTK account service");
    }
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOperatorSessions(
  runtime: RuntimeConfig,
  launcherKey: unknown,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; launcherVersion?: string } = {},
): Promise<OperatorRemoteFeed> {
  const fetchedAt = new Date().toISOString();
  if (!isValidPlayerKey(launcherKey)) {
    return { ...EMPTY_OPERATOR_REMOTE_FEED, status: "idle", error: "Add a ROTK launcher key first." };
  }
  try {
    const { status, payload } = await postOperatorJson(
      operatorSessionsEndpoint(runtime),
      {
        launcherKey: normalizePlayerKey(launcherKey),
        ...(options.launcherVersion ? { launcherVersion: options.launcherVersion } : {}),
      },
      options,
    );
    if (status === 404 || status === 501) {
      return {
        ...EMPTY_OPERATOR_REMOTE_FEED,
        status: "unavailable",
        error: "The account service does not offer operator sessions yet.",
        fetchedAt,
      };
    }
    if (status === 401) {
      return {
        ...EMPTY_OPERATOR_REMOTE_FEED,
        status: "forbidden",
        error: "The ROTK launcher key was rejected.",
        fetchedAt,
      };
    }
    if (status === 403) {
      return {
        ...EMPTY_OPERATOR_REMOTE_FEED,
        status: "forbidden",
        error: "This ROTK account is not a moderator.",
        fetchedAt,
      };
    }
    if (status < 200 || status >= 300) {
      return {
        ...EMPTY_OPERATOR_REMOTE_FEED,
        status: "unavailable",
        error: "The ROTK account service refused the operator request.",
        fetchedAt,
      };
    }
    return { ...parseOperatorSessions(payload), fetchedAt };
  } catch (error) {
    return {
      ...EMPTY_OPERATOR_REMOTE_FEED,
      status: "unavailable",
      error: error instanceof Error ? error.message : "Unable to reach the ROTK account service",
      fetchedAt,
    };
  }
}

export async function submitOperatorIpBan(
  runtime: RuntimeConfig,
  launcherKey: unknown,
  ip: string,
  reason: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: OperatorRemoteStatus; error?: string }> {
  if (!isValidPlayerKey(launcherKey)) {
    return { ok: false, status: "idle", error: "Add a ROTK launcher key first." };
  }
  try {
    const { status, payload } = await postOperatorJson(
      operatorBansEndpoint(runtime),
      {
        launcherKey: normalizePlayerKey(launcherKey),
        ip,
        reason,
      },
      options,
    );
    if (status === 404 || status === 501) {
      return { ok: false, status: "unavailable", error: "The account service does not offer operator IP bans yet." };
    }
    if (status === 401 || status === 403) {
      return {
        ok: false,
        status: "forbidden",
        error: status === 401
          ? "The ROTK launcher key was rejected."
          : "This ROTK account is not a moderator.",
      };
    }
    if (status < 200 || status >= 300) {
      const message = payload && typeof payload === "object" && "error" in payload
        ? asString((payload as { error: unknown }).error)
        : "";
      return {
        ok: false,
        status: "unavailable",
        error: message || "The ROTK account service refused the IP ban.",
      };
    }
    return { ok: true, status: "ok" };
  } catch (error) {
    return {
      ok: false,
      status: "unavailable",
      error: error instanceof Error ? error.message : "Unable to reach the ROTK account service",
    };
  }
}
