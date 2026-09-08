import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileText, FolderOpen, RefreshCw, X } from "lucide-react";
import type { OperationResult } from "../../shared/contracts";
import type { DiagnosticReportSummary, DiagnosticState } from "../../shared/diagnostics";
import {
  diagnosticDuration, diagnosticExitCode, diagnosticFileName, diagnosticSize,
  latestDiagnosticIncident, newestReports, selectedDiagnosticId,
} from "../diagnostics-state";
import { useI18n } from "../i18n";

interface DiagnosticsPanelProps {
  open: boolean;
  gameRunning: boolean;
  gameLaunching: boolean;
  notificationHidden?: boolean;
  onOpen(): void;
  onClose(): void;
}

type Operation = "capture" | "export" | "folder" | "setting";
type MessageKey = "failedLoad" | "failedCapture" | "failedExport" | "failedFolder" | "failedSetting"
  | "cancelled" | "captured" | "settingSaved" | "folderOpened";
type Feedback = { tone: "error" | "success" | "info"; key: MessageKey } | { tone: "success"; fileName: string };
const NOTICE_STORAGE_KEY = "rotk.launcher.lastAcknowledgedDiagnostic";

function acknowledgedIncident(): string | null {
  try { return window.localStorage.getItem(NOTICE_STORAGE_KEY); } catch { return null; }
}

export function DiagnosticsPanel({ open, gameRunning, gameLaunching, notificationHidden, onOpen, onClose }: DiagnosticsPanelProps) {
  const { copy, locale } = useI18n();
  const text = copy.diagnostics;
  const [state, setState] = useState<DiagnosticState | null>(null);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [includeDumps, setIncludeDumps] = useState(true);
  const [captureMode, setCaptureMode] = useState<"standard" | "full">("standard");
  const [acknowledged, setAcknowledged] = useState<string | null>(acknowledgedIncident);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const operationLock = useRef(false);
  const revision = useRef(0);
  const refreshId = useRef(0);
  const previousOpen = useRef(open);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;

  const receiveState = useCallback((next: DiagnosticState) => {
    revision.current += 1;
    const reports = newestReports(next.reports);
    setState({ ...next, reports });
    setSelectedId((current) => selectedDiagnosticId(reports, current));
    setFeedback((current) => current && "key" in current && current.key === "failedLoad" ? null : current);
  }, []);

  const refresh = useCallback(async () => {
    const requestId = ++refreshId.current;
    const stateRevision = revision.current;
    setLoading(true);
    try {
      const result = await window.rotk.getDiagnosticReports();
      if (!mounted.current || requestId !== refreshId.current) return;
      // An event received during this read is newer than its eventual result.
      if (stateRevision !== revision.current) return;
      if (result.ok && result.value) {
        receiveState(result.value);
        setFeedback((current) => current && "key" in current && current.key === "failedLoad" ? null : current);
      } else if (!result.cancelled) setFeedback({ tone: "error", key: "failedLoad" });
    } catch {
      if (mounted.current && requestId === refreshId.current && stateRevision === revision.current) {
        setFeedback({ tone: "error", key: "failedLoad" });
      }
    } finally {
      if (mounted.current && requestId === refreshId.current) setLoading(false);
    }
  }, [receiveState]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = window.rotk.onDiagnosticsChanged((next) => {
      if (mounted.current) receiveState(next);
    });
    void refresh();
    return () => { mounted.current = false; unsubscribe(); };
  }, [receiveState, refresh]);

  useEffect(() => {
    if (open && !previousOpen.current) void refresh();
    previousOpen.current = open;
  }, [open, refresh]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    closeRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  const selected = state?.reports.find((report) => report.id === selectedId) ?? null;
  const incident = latestDiagnosticIncident(state?.reports ?? []);
  const notification = incident && incident.id !== acknowledged ? incident : null;
  const working = Boolean(operation || state?.busy);

  const acknowledge = useCallback((id: string) => {
    setAcknowledged(id);
    try { window.localStorage.setItem(NOTICE_STORAGE_KEY, id); } catch { /* Keep the in-memory dismissal. */ }
  }, []);

  useEffect(() => {
    if (open && selected && selected.id === notification?.id) acknowledge(selected.id);
  }, [open, selected?.id, notification?.id, acknowledge]);

  function chooseReport(id: string) {
    setSelectedId(id);
    setIncludeDumps(true);
    if (!operation) setFeedback(null);
  }

  async function run<T>(
    kind: Operation,
    action: () => Promise<OperationResult<T>>,
    success: (value: T | undefined) => void,
    failure: MessageKey,
  ) {
    if (operationLock.current || state?.busy) return;
    operationLock.current = true;
    setOperation(kind);
    setFeedback(null);
    try {
      const result = await action();
      if (!mounted.current) return;
      if (result.cancelled) {
        if (kind === "export") setFeedback({ tone: "info", key: "cancelled" });
      } else if (result.ok) success(result.value);
      else setFeedback({ tone: "error", key: failure });
    } catch {
      if (mounted.current) setFeedback({ tone: "error", key: failure });
    } finally {
      operationLock.current = false;
      if (mounted.current) setOperation(null);
    }
  }

  function capture() {
    void run("capture", () => window.rotk.captureDiagnostic({ mode: captureMode, description: "" }), (report) => {
      if (!report) { setFeedback({ tone: "error", key: "failedCapture" }); return; }
      setSelectedId(report.id);
      setIncludeDumps(true);
      setFeedback({ tone: "success", key: "captured" });
      void refresh();
    }, "failedCapture");
  }

  function exportReport() {
    if (!selected) return;
    void run("export", () => window.rotk.exportDiagnostic({
      reportId: selected.id,
      includeDumps,
      description: (notes[selected.id] ?? "").slice(0, 4000),
    }), (value) => {
      setFeedback(value?.fileName
        ? { tone: "success", fileName: diagnosticFileName(value.fileName) }
        : { tone: "error", key: "failedExport" });
    }, "failedExport");
  }

  function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? text.unknown : new Intl.DateTimeFormat(locale, {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(date);
  }

  const feedbackText = feedback && ("fileName" in feedback ? text.exported(feedback.fileName) : text[feedback.key]);

  return (
    <>
      {notification && !open && !notificationHidden && (
        <div className="diagnostic-notice" role="status">
          <FileText size={19} aria-hidden="true" />
          <div>
            <strong>{text.newCrash}</strong>
            <button type="button" onClick={() => { chooseReport(notification.id); acknowledge(notification.id); onOpen(); }}>
              {text.openReport}
            </button>
          </div>
          <button type="button" className="diagnostic-notice__close" aria-label={text.dismiss} onClick={() => acknowledge(notification.id)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <dialog
        ref={dialogRef}
        className="diagnostics-panel"
        aria-labelledby="diagnostics-title"
        aria-describedby="diagnostics-intro"
        onCancel={(event) => { event.preventDefault(); closeCallback.current(); }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [href], [tabindex]:not([tabindex="-1"])',
          )).filter((element) => element.getClientRects().length > 0);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
          }
        }}
        onClick={(event) => {
          if (event.target !== dialogRef.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
            closeCallback.current();
          }
        }}
      >
        <header className="diagnostics-panel__header">
          <div><span className="eyebrow">ROTK · {text.reports}</span><h2 id="diagnostics-title">{text.title}</h2></div>
          <button ref={closeRef} type="button" className="panel-close" aria-label={text.close} onClick={onClose}><X size={20} /></button>
        </header>
        <div className="diagnostics-panel__body">
          <p id="diagnostics-intro" className="diagnostics-intro">{text.intro}</p>
          <section className="diagnostics-capture" aria-labelledby="diagnostics-capture-title">
            <div><h3 id="diagnostics-capture-title">{text.captureTitle}</h3><p>{gameRunning ? text.captureHint : text.launchToCapture}</p></div>
            <div className="diagnostics-capture__controls">
              <select aria-label={text.captureMode} value={captureMode} disabled={!gameRunning || working} onChange={(event) => setCaptureMode(event.target.value as "standard" | "full")}>
                <option value="standard">{text.standard}</option><option value="full">{text.full}</option>
              </select>
              <button type="button" className="diagnostics-button" disabled={!gameRunning || working || !state} onClick={capture}>
                {operation === "capture" ? <RefreshCw className="diagnostics-spin" size={15} /> : <FileText size={15} />}
                {operation === "capture" ? text.capturing : text.capture}
              </button>
            </div>
            {captureMode === "full" && <p className="diagnostics-capture__hint">{text.fullHint}</p>}
          </section>

          <div className="diagnostics-workspace">
            <section className="diagnostics-history" aria-labelledby="diagnostics-history-title">
              <header><h3 id="diagnostics-history-title">{text.history}</h3><button type="button" aria-label={text.refresh} title={text.refresh} disabled={loading || working} onClick={() => void refresh()}><RefreshCw size={15} className={loading ? "diagnostics-spin" : undefined} /></button></header>
              {loading && !state && <p className="diagnostics-empty" role="status">{text.loading}</p>}
              {!loading && state?.reports.length === 0 && <div className="diagnostics-empty"><FileText size={28} /><strong>{text.empty}</strong><p>{text.emptyHint}</p></div>}
              <ul className="diagnostics-history__list">
                {state?.reports.map((report) => (
                  <li key={report.id}>
                    <button type="button" className={report.id === selected?.id ? "is-selected" : ""} aria-current={report.id === selected?.id ? "true" : undefined} onClick={() => chooseReport(report.id)}>
                      <span><strong>{text.kind[report.kind]}</strong><i className={`diagnostics-status is-${report.status}`}>{text.status[report.status]}</i></span>
                      <time dateTime={report.startedAt}>{formatDate(report.startedAt)}</time>
                      <small>{report.dumpCount} {text.dumps.toLocaleLowerCase(locale)} · {diagnosticSize(report.totalBytes, locale)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="diagnostics-detail" aria-label={text.openReport}>
              {selected ? (
                <>
                  <div className="diagnostics-detail__heading"><h3>{text.kind[selected.kind]}</h3><span className={`diagnostics-status is-${selected.status}`}>{text.status[selected.status]}</span></div>
                  <dl className="diagnostics-facts">
                    <div><dt>{text.date}</dt><dd>{formatDate(selected.startedAt)}</dd></div>
                    <div><dt>{text.duration}</dt><dd>{diagnosticDuration(selected.durationMs) ?? (selected.status === "recording" ? text.live : text.unknown)}</dd></div>
                    <div><dt>{text.exitCode}</dt><dd className="diagnostics-code">{diagnosticExitCode(selected.exitCodeHex) ?? text.noCode}</dd></div>
                    <div><dt>{text.captureStatus}</dt><dd>{text.captureStates[selected.captureStatus]}</dd></div>
                    <div><dt>{text.dumps}</dt><dd>{selected.dumpCount}{selected.hasFullDump && <small>{text.fullIncluded}</small>}</dd></div>
                    <div><dt>{text.size}</dt><dd>{diagnosticSize(selected.totalBytes, locale)}</dd></div>
                  </dl>
                  <ReportNotes report={selected} />
                  <label className="diagnostics-notes" htmlFor="diagnostics-description"><span>{text.notes}<small>{(notes[selected.id] ?? "").length}/4000</small></span>
                    <textarea id="diagnostics-description" rows={3} maxLength={4000} placeholder={text.notesPlaceholder} value={notes[selected.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [selected.id]: event.target.value.slice(0, 4000) }))} />
                  </label>
                  <label className="diagnostics-checkbox"><input type="checkbox" checked={includeDumps} disabled={working || selected.dumpCount === 0} onChange={(event) => setIncludeDumps(event.target.checked)} /><span>{text.includeDumps}</span></label>
                  <p className="diagnostics-privacy">{text.privacy}</p>
                  <div className="diagnostics-export">
                    <button type="button" className="diagnostics-button is-primary" disabled={working || selected.status === "collecting"} onClick={exportReport}>
                      {operation === "export" ? <RefreshCw size={16} className="diagnostics-spin" /> : <Download size={16} />}{operation === "export" ? text.exporting : text.export}
                    </button>
                    <p>{text.localOnly}</p>
                  </div>
                </>
              ) : <p className="diagnostics-empty">{text.selectReport}</p>}
            </section>
          </div>

          <div className={`diagnostics-feedback ${feedback ? `is-${feedback.tone}` : ""}`} role={feedback?.tone === "error" ? "alert" : "status"} aria-atomic="true">
            {feedbackText || (state?.error ? text.partial : "")}
          </div>

          <div className="diagnostics-bottom">
            <details className="diagnostics-advanced"><summary><ChevronDown size={15} />{text.advanced}</summary>
              <label className="diagnostics-checkbox"><input type="checkbox" checked={state?.advancedCaptureEnabled ?? true} disabled={gameRunning || gameLaunching || working || !state} onChange={(event) => {
                const enabled = event.target.checked;
                void run("setting", () => window.rotk.setDiagnosticCaptureEnabled(enabled), (value) => {
                  if (!value) { setFeedback({ tone: "error", key: "failedSetting" }); return; }
                  receiveState(value); setFeedback({ tone: "success", key: "settingSaved" });
                }, "failedSetting");
              }} /><span>{text.advancedToggle}</span></label>
              <p>{gameRunning || gameLaunching ? text.advancedLocked : text.advancedHint}</p>
            </details>
            <button type="button" className="diagnostics-folder" disabled={working} onClick={() => void run("folder", () => window.rotk.openDiagnosticsFolder(), () => setFeedback({ tone: "success", key: "folderOpened" }), "failedFolder")}><FolderOpen size={16} />{text.openFolder}</button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function ReportNotes({ report }: { report: DiagnosticReportSummary }) {
  const { copy } = useI18n();
  const text = copy.diagnostics;
  const messages: string[] = [];
  if (report.status === "recording") messages.push(text.recordingHint);
  if (report.status === "collecting") messages.push(text.collectingHint);
  if (report.kind === "interrupted") messages.push(text.interruptedHint);
  if (report.status === "partial" || report.warnings.length > 0) messages.push(text.partial);
  if (report.dumpCount === 0 && report.status !== "recording" && report.status !== "collecting") messages.push(text.missingDump);
  if (messages.length === 0) return null;
  return <div className="diagnostics-report-notes">{messages.map((message) => <p key={message}>{message}</p>)}</div>;
}
