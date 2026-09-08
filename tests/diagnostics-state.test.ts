import { describe, expect, it } from "vitest";
import type { DiagnosticReportSummary } from "../shared/diagnostics";
import { diagnosticDuration, diagnosticExitCode, diagnosticFileName, diagnosticSize, latestDiagnosticIncident, newestReports, selectedDiagnosticId } from "../src/diagnostics-state";
import { DIAGNOSTICS_COPY } from "../src/diagnostics-copy";

function report(id: string, patch: Partial<DiagnosticReportSummary> = {}): DiagnosticReportSummary {
  return {
    id, startedAt: "2026-09-08T12:00:00.000Z", endedAt: "2026-09-08T12:20:00.000Z",
    kind: "exit", status: "ready", launcherVersion: "2.0.7", serverLabel: "GAME 2",
    playerName: null, exitCodeHex: "0x00000000", durationMs: 1200000, dumpCount: 0,
    hasFullDump: false, totalBytes: 40000, captureStatus: "finished", warnings: [], ...patch,
  };
}

describe("diagnostic history presentation", () => {
  it("recovers the newest incident after relaunch without treating a normal exit or collecting report as ready", () => {
    const rows = [
      report("interrupted", { kind: "interrupted", status: "partial" }),
      report("exit", { startedAt: "2026-09-08T13:00:00.000Z" }),
      report("new-crash", { startedAt: "2026-09-08T14:00:00.000Z", kind: "crash", status: "collecting" }),
    ];
    expect(latestDiagnosticIncident(rows)?.id).toBe("interrupted");
    rows[2].status = "ready";
    expect(latestDiagnosticIncident(rows)?.id).toBe("new-crash");
  });

  it("keeps a selected older session during updates and chooses an available report after retention removes it", () => {
    const rows = [report("older"), report("newer", { startedAt: "2026-09-09T12:00:00.000Z" })];
    const sorted = newestReports(rows);
    expect(rows[0].id).toBe("older");
    expect(selectedDiagnosticId(sorted, "older")).toBe("older");
    expect(selectedDiagnosticId(sorted, "removed")).toBe("newer");
    expect(selectedDiagnosticId([], "older")).toBeNull();
  });

  it("shows only a validated exit code and a filename instead of arbitrary backend text or local paths", () => {
    expect(diagnosticExitCode("0xc0000005")).toBe("0xC0000005");
    expect(diagnosticExitCode("failed at C:\\Users\\Player\\private.txt")).toBeNull();
    expect(diagnosticExitCode(null)).toBeNull();
    expect(diagnosticFileName("C:\\Users\\Player\\Desktop\\crash.zip")).toBe("crash.zip");
    expect(diagnosticFileName("/tmp/report\u0000.zip")).toBe("report.zip");
  });

  it("formats empty and large reports and unknown durations without misleading values", () => {
    expect(diagnosticSize(0, "en")).toBe("0 B");
    expect(diagnosticSize(3 * 1024 ** 3, "fr")).toBe("3 Go");
    expect(diagnosticSize(Number.NaN, "en")).toBe("—");
    expect(diagnosticDuration(null)).toBeNull();
    expect(diagnosticDuration(3_661_000)).toBe("1 h 1 min");
  });

  it("provides complete French and English states for actionable reports", () => {
    for (const copy of Object.values(DIAGNOSTICS_COPY)) {
      for (const kind of ["crash", "exit", "interrupted", "manual", "launch-error"] as const) expect(copy.kind[kind]).toBeTruthy();
      for (const status of ["recording", "collecting", "ready", "partial"] as const) expect(copy.status[status]).toBeTruthy();
      expect(copy.exported("report.zip")).toContain("report.zip");
      expect(copy.missingDump).toBeTruthy();
      expect(copy.cancelled).toBeTruthy();
    }
  });
});
