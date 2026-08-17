import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addOperatorIpBan,
  isLoopbackAddress,
  isValidIpAddress,
  normalizeClientAddress,
  operatorDataDirectory,
  readOperatorBans,
  readOperatorConnections,
} from "../electron/services/operator-ip.js";

describe("operator IP bans", () => {
  it("shares the zone operator folder under %APPDATA%/h1emu/operator", () => {
    expect(operatorDataDirectory("C:\\Users\\hyman\\AppData\\Roaming")).toBe(
      join("C:\\Users\\hyman\\AppData\\Roaming", "h1emu", "operator"),
    );
  });

  it("normalizes mapped IPv4 and rejects loopback bans", () => {
    expect(normalizeClientAddress("::ffff:203.0.113.10")).toBe("203.0.113.10");
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isValidIpAddress("127.0.0.1")).toBe(false);
    expect(isValidIpAddress("203.0.113.10")).toBe(true);
    expect(isValidIpAddress("not-an-ip")).toBe(false);
  });

  it("reads zone connection history and writes an IP ban the zone will enforce", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rotk-launcher-operator-ip-"));
    await writeFile(
      join(directory, "connections.json"),
      `${JSON.stringify([
        { loginSessionId: "sess-1", name: "Jin", ip: "203.0.113.10", at: "2026-08-17T12:00:00.000Z" },
      ], null, 2)}\n`,
      "utf8",
    );
    expect((await readOperatorConnections(directory))[0]?.ip).toBe("203.0.113.10");
    expect((await addOperatorIpBan(directory, "127.0.0.1", "solo")).ok).toBe(false);
    const banned = await addOperatorIpBan(directory, "::ffff:203.0.113.10", "cheat");
    expect(banned).toEqual({ ok: true, ip: "203.0.113.10" });
    expect(await addOperatorIpBan(directory, "203.0.113.10", "again")).toEqual({
      ok: false,
      error: "203.0.113.10 is already banned.",
    });
    const bans = await readOperatorBans(directory);
    expect(bans).toHaveLength(1);
    expect(bans[0]).toMatchObject({
      IP: "203.0.113.10",
      banReason: "cheat",
      adminId: "launcher",
      active: true,
    });
    const persisted = JSON.parse(await readFile(join(directory, "bans.json"), "utf8"));
    expect(persisted[0].IP).toBe("203.0.113.10");
  });
});
