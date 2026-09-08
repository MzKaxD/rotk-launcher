import type { DiagnosticReportSummary } from "../shared/diagnostics";

export function newestReports(reports: DiagnosticReportSummary[]): DiagnosticReportSummary[] {
  return [...reports].sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
}

export function selectedDiagnosticId(reports: DiagnosticReportSummary[], current: string | null): string | null {
  return reports.some((report) => report.id === current) ? current : reports[0]?.id ?? null;
}

export function latestDiagnosticIncident(reports: DiagnosticReportSummary[]): DiagnosticReportSummary | null {
  return newestReports(reports).find((report) =>
    ["crash", "interrupted", "launch-error"].includes(report.kind)
    && ["ready", "partial"].includes(report.status),
  ) ?? null;
}

/** The renderer only displays a Windows code, never a raw backend error. */
export function diagnosticExitCode(value: string | null): string | null {
  return value && /^0x[0-9a-f]{1,8}$/i.test(value) ? value.toUpperCase().replace("0X", "0x") : null;
}

/** Save dialogs may return an absolute path on older builds. Show just its name. */
export function diagnosticFileName(value: string): string {
  return value.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "report.zip";
}

export function diagnosticSize(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = locale === "fr" ? ["o", "Ko", "Mo", "Go"] : ["B", "KB", "MB", "GB"];
  const unit = bytes > 0 ? Math.max(0, Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)))) : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit > 0 ? 1 : 0 }).format(bytes / 1024 ** unit)} ${units[unit]}`;
}

export function diagnosticDuration(milliseconds: number | null): string | null {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
    : `${minutes} min ${seconds % 60} s`;
}
