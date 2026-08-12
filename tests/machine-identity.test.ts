import { describe, expect, it } from "vitest";
import {
  cleanComponent,
  collectHwid,
  parseCimValue,
  parseMachineGuid,
  type MachineIdentitySources,
} from "../electron/services/machine-identity";

describe("machine identity parsing", () => {
  it("drops placeholder and empty values", () => {
    expect(cleanComponent("  Real-Serial-123 ")).toBe("real-serial-123");
    expect(cleanComponent("")).toBeUndefined();
    expect(cleanComponent("To be filled by O.E.M.")).toBeUndefined();
    expect(cleanComponent("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF")).toBeUndefined();
    expect(cleanComponent("System Serial Number")).toBeUndefined();
    expect(cleanComponent(null)).toBeUndefined();
  });

  it("reads MachineGuid out of reg query output", () => {
    const stdout = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n"
      + "    MachineGuid    REG_SZ    3f2504e0-4f89-41d3-9a0c-0305e82c3301\r\n";
    expect(parseMachineGuid(stdout)).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(parseMachineGuid("nothing here")).toBeUndefined();
  });

  it("reads a single expanded CIM value", () => {
    expect(parseCimValue("\r\nBTXH-42-ABC \r\n")).toBe("btxh-42-abc");
    expect(parseCimValue("   ")).toBeUndefined();
  });
});

describe("collectHwid", () => {
  const sources = (over: Partial<MachineIdentitySources> = {}): MachineIdentitySources => ({
    machineGuid: async () => "mg-1",
    smbiosUuid: async () => "sm-2",
    baseboardSerial: async () => "bb-3",
    diskSerial: async () => "dk-4",
    volumeSerial: async () => "vol-5",
    ...over,
  });

  it("assembles the full vector", async () => {
    if (process.platform !== "win32") return; // gated on win32; collector is a no-op elsewhere
    const vector = await collectHwid(sources());
    expect(vector).toEqual({
      machine_guid: "mg-1", smbios_uuid: "sm-2", baseboard_serial: "bb-3",
      disk_serial: "dk-4", volume_serial: "vol-5",
    });
  });

  it("omits a component that fails or is empty, without throwing", async () => {
    if (process.platform !== "win32") return;
    const vector = await collectHwid(sources({
      diskSerial: async () => { throw new Error("wmi failed"); },
      volumeSerial: async () => undefined,
    }));
    expect(vector).toEqual({ machine_guid: "mg-1", smbios_uuid: "sm-2", baseboard_serial: "bb-3" });
  });

  it("returns an empty vector off Windows", async () => {
    if (process.platform === "win32") return;
    expect(await collectHwid(sources())).toEqual({});
  });
});
