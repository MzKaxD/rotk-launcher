/**
 * Composite hardware fingerprint (Windows).
 *
 * The launcher collects a handful of stable machine identifiers and sends the
 * RAW values with the ticket request; the server keyed-hashes each and stores
 * only the digests (never the raw value, never on the launcher side either).
 * No single component is trusted — the server matches a HWID ban fuzzily, so
 * changing one serial does not evade it. This is a userland fingerprint on an
 * open-source launcher: a cost to ban evasion, not an unspoofable identity. The
 * TPM anchor (a separate, later change) is what raises that cost.
 *
 * Every collector is best-effort: a component that cannot be read is simply
 * omitted, and an empty vector is valid (the machine just contributes no HWID
 * signal). Collection never throws into the launch path.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The fingerprint slots, matching the server's HWID_COMPONENTS. */
export interface HwidVector {
  machine_guid?: string;
  smbios_uuid?: string;
  baseboard_serial?: string;
  disk_serial?: string;
  volume_serial?: string;
}

/** Values a real machine never legitimately reports; dropped if seen. */
const PLACEHOLDER_VALUES = new Set([
  "", "0", "none", "n/a", "na", "null", "default string", "to be filled by o.e.m.",
  "system serial number", "not applicable", "not available", "无", "00000000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff", "00000000-0000-0000-0000-000000000000",
]);

/** Trim, collapse whitespace, lowercase, and reject known placeholders. */
export function cleanComponent(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized === "" || PLACEHOLDER_VALUES.has(normalized)) return undefined;
  return normalized;
}

/** MachineGuid from the `reg query` output for HKLM\SOFTWARE\Microsoft\Cryptography. */
export function parseMachineGuid(stdout: string): string | undefined {
  const match = stdout.match(/MachineGuid\s+REG_SZ\s+(.+)/i);
  return cleanComponent(match?.[1]);
}

/**
 * A single-value field from PowerShell CIM output. The collectors below ask for
 * exactly one property with `-ExpandProperty`, so the whole trimmed output is
 * the value.
 */
export function parseCimValue(stdout: string): string | undefined {
  return cleanComponent(stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== ""));
}

async function reg(path: string, value: string): Promise<string> {
  const { stdout } = await execFileAsync("reg", ["query", path, "/v", value], { windowsHide: true });
  return stdout;
}

async function cim(command: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true, timeout: 8_000 },
  );
  return stdout;
}

/** Overridable for tests; production reads the real machine. */
export interface MachineIdentitySources {
  machineGuid(): Promise<string | undefined>;
  smbiosUuid(): Promise<string | undefined>;
  baseboardSerial(): Promise<string | undefined>;
  diskSerial(): Promise<string | undefined>;
  volumeSerial(): Promise<string | undefined>;
}

const WINDOWS_SOURCES: MachineIdentitySources = {
  machineGuid: async () =>
    parseMachineGuid(await reg("HKLM\\SOFTWARE\\Microsoft\\Cryptography", "MachineGuid")),
  smbiosUuid: async () =>
    parseCimValue(await cim("(Get-CimInstance Win32_ComputerSystemProduct).UUID")),
  baseboardSerial: async () =>
    parseCimValue(await cim("(Get-CimInstance Win32_BaseBoard).SerialNumber")),
  diskSerial: async () =>
    parseCimValue(await cim(
      "Get-CimInstance Win32_DiskDrive | Where-Object { $_.Index -eq 0 } "
      + "| Select-Object -First 1 -ExpandProperty SerialNumber",
    )),
  volumeSerial: async () =>
    parseCimValue(await cim(
      "(Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='$($env:SystemDrive)'\").VolumeSerialNumber",
    )),
};

/**
 * Collect the fingerprint. Each slot is gathered independently and a failing or
 * empty one is dropped. Non-Windows returns an empty vector (Linux/Proton is out
 * of scope for v1; the server treats the absence as no HWID signal).
 */
export async function collectHwid(
  sources: MachineIdentitySources = WINDOWS_SOURCES,
): Promise<Record<string, string>> {
  if (process.platform !== "win32") return {};
  const slots: [keyof HwidVector, () => Promise<string | undefined>][] = [
    ["machine_guid", sources.machineGuid],
    ["smbios_uuid", sources.smbiosUuid],
    ["baseboard_serial", sources.baseboardSerial],
    ["disk_serial", sources.diskSerial],
    ["volume_serial", sources.volumeSerial],
  ];
  const vector: Record<string, string> = {};
  await Promise.all(slots.map(async ([key, read]) => {
    try {
      const value = await read();
      if (value !== undefined) vector[key] = value;
    } catch {
      // best-effort: a slot that cannot be read is simply absent.
    }
  }));
  return vector;
}
