import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const OPERATOR_BANS_LIMIT = 500;
export const OPERATOR_CONNECTIONS_DISPLAY = 80;

const IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6 =
  /^(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}$|^::(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4}$|^[0-9a-f]{1,4}::(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4}$/i;

export interface OperatorConnection {
  loginSessionId: string;
  name: string;
  ip: string;
  at: string;
}

export interface OperatorFileBan {
  name: string;
  loginSessionId: string;
  IP: string;
  banReason: string;
  adminId: string;
  expirationDate: number;
  active: boolean;
  at: string;
}

export function operatorDataDirectory(appDataRoot: string): string {
  return join(appDataRoot, "h1emu", "operator");
}

export function normalizeClientAddress(address: string): string {
  const trimmed = address.trim().toLowerCase();
  if (trimmed.startsWith("::ffff:")) return trimmed.slice(7);
  return trimmed;
}

export function isLoopbackAddress(address: string): boolean {
  const ip = normalizeClientAddress(address);
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

export function isValidIpAddress(address: string): boolean {
  const ip = normalizeClientAddress(address);
  if (!ip || isLoopbackAddress(ip)) return false;
  return IPV4.test(ip) || IPV6.test(ip);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function sanitizeOperatorConnections(raw: unknown): OperatorConnection[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const ip = asString(record.ip);
    if (!ip) return [];
    return [{
      loginSessionId: asString(record.loginSessionId),
      name: asString(record.name),
      ip,
      at: asString(record.at),
    }];
  });
}

export function sanitizeOperatorBans(raw: unknown): OperatorFileBan[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const ip = asString(record.IP);
    if (!ip) return [];
    return [{
      name: asString(record.name),
      loginSessionId: asString(record.loginSessionId),
      IP: ip,
      banReason: asString(record.banReason),
      adminId: asString(record.adminId),
      expirationDate: typeof record.expirationDate === "number" ? record.expirationDate : 0,
      active: record.active !== false,
      at: asString(record.at),
    }];
  });
}

export async function readOperatorConnections(directory: string): Promise<OperatorConnection[]> {
  try {
    return sanitizeOperatorConnections(
      JSON.parse(await readFile(join(directory, "connections.json"), "utf8")),
    );
  } catch {
    return [];
  }
}

export async function readOperatorBans(directory: string): Promise<OperatorFileBan[]> {
  try {
    return sanitizeOperatorBans(
      JSON.parse(await readFile(join(directory, "bans.json"), "utf8")),
    );
  } catch {
    return [];
  }
}

export async function addOperatorIpBan(
  directory: string,
  ip: string,
  reason: string,
): Promise<{ ok: boolean; error?: string; ip?: string }> {
  const normalized = normalizeClientAddress(ip);
  if (!isValidIpAddress(normalized)) {
    return {
      ok: false,
      error: isLoopbackAddress(normalized)
        ? "Loopback addresses cannot be banned."
        : "That is not a valid IP address.",
    };
  }
  const bans = await readOperatorBans(directory);
  if (bans.some((ban) => ban.active && normalizeClientAddress(ban.IP) === normalized)) {
    return { ok: false, error: `${normalized} is already banned.` };
  }
  bans.push({
    name: normalized,
    loginSessionId: "",
    IP: normalized,
    banReason: reason.trim() || "ip ban",
    adminId: "launcher",
    expirationDate: 0,
    active: true,
    at: new Date().toISOString(),
  });
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "bans.json"), `${JSON.stringify(bans.slice(-OPERATOR_BANS_LIMIT), null, 2)}\n`, "utf8");
  return { ok: true, ip: normalized };
}
