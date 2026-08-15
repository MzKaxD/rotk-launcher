import { describe, expect, it } from "vitest";
import {
  listIsolatedRotkCandidates,
  locateIsolatedRotkClient,
  type RotkLocatorDependencies,
} from "../electron/services/rotk-locator.js";

function dependencies(options: {
  existingDirectories?: string[];
  classified?: Record<string, { root: string; kind: "direct" | "copy-required" }>;
  marked?: string[];
  systemDrive?: string;
  availableDrives?: string[];
}): RotkLocatorDependencies {
  const existing = new Set((options.existingDirectories ?? []).map((path) => path.toLocaleLowerCase("en-US")));
  const marked = new Set((options.marked ?? []).map((path) => path.toLocaleLowerCase("en-US")));
  return {
    directoryExists: async (path) => existing.has(path.toLocaleLowerCase("en-US")),
    classify: async (path) => {
      const mapped = options.classified?.[path] ?? options.classified?.[path.toLocaleLowerCase("en-US")];
      if (mapped) return mapped;
      throw new Error("not a client");
    },
    hasMarker: async (path) => marked.has(path.toLocaleLowerCase("en-US")),
    systemDrive: options.systemDrive ?? "C:",
    availableDrives: options.availableDrives ?? ["C:", "S:"],
  };
}

describe("isolated ROTK locator", () => {
  it("lists Games\\ROTK before a bare ROTK folder, system drive first", () => {
    expect(listIsolatedRotkCandidates("C:", ["S:", "C:"])).toEqual([
      "C:\\Games\\ROTK",
      "C:\\ROTK",
      "S:\\Games\\ROTK",
      "S:\\ROTK",
    ]);
  });

  it("prefers a marked ROTK install on another drive over a bare tree", async () => {
    const located = await locateIsolatedRotkClient(dependencies({
      existingDirectories: ["C:\\Games\\ROTK", "S:\\Games\\ROTK"],
      classified: {
        "C:\\Games\\ROTK": { root: "C:\\Games\\ROTK", kind: "direct" },
        "S:\\Games\\ROTK": { root: "S:\\Games\\ROTK", kind: "direct" },
      },
      marked: ["S:\\Games\\ROTK"],
    }));
    expect(located).toBe("S:\\Games\\ROTK");
  });

  it("ignores a Steam-hosted client even if the folder exists", async () => {
    const located = await locateIsolatedRotkClient(dependencies({
      existingDirectories: ["S:\\Games\\ROTK"],
      availableDrives: ["S:"],
      classified: {
        "S:\\Games\\ROTK": { root: "S:\\Games\\ROTK", kind: "copy-required" },
      },
    }));
    expect(located).toBeNull();
  });

  it("returns the first valid standalone client when no marker exists", async () => {
    const located = await locateIsolatedRotkClient(dependencies({
      existingDirectories: ["S:\\Games\\ROTK"],
      classified: {
        "S:\\Games\\ROTK": { root: "S:\\Games\\ROTK", kind: "direct" },
      },
    }));
    expect(located).toBe("S:\\Games\\ROTK");
  });
});
