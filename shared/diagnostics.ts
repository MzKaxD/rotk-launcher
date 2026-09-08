export type DiagnosticReportKind = "crash" | "exit" | "interrupted" | "manual" | "launch-error";
export type DiagnosticReportStatus = "recording" | "collecting" | "ready" | "partial";
export type DiagnosticCaptureStatus = "pending" | "attached" | "unavailable" | "disabled" | "finished";

export interface DiagnosticReportSummary {
  id: string;
  startedAt: string;
  endedAt: string | null;
  kind: DiagnosticReportKind;
  status: DiagnosticReportStatus;
  launcherVersion: string;
  serverLabel: string;
  playerName: string | null;
  exitCodeHex: string | null;
  durationMs: number | null;
  dumpCount: number;
  hasFullDump: boolean;
  totalBytes: number;
  captureStatus: DiagnosticCaptureStatus;
  warnings: string[];
}

export interface DiagnosticState {
  reports: DiagnosticReportSummary[];
  recordingId: string | null;
  busy: boolean;
  advancedCaptureEnabled: boolean;
  error: string | null;
}

export interface DiagnosticCaptureRequest {
  mode: "standard" | "full";
  description: string;
}

export interface DiagnosticExportRequest {
  reportId: string;
  includeDumps: boolean;
  description: string;
}
