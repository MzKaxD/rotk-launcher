import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleAlert, LoaderCircle, X } from "lucide-react";
import { useI18n } from "../i18n";

type Feedback = "preparing" | "ready" | "failed" | null;

export function useCrashReport() {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reportCrash = useCallback(async () => {
    // Close the gap before React renders busy, including repeated Enter presses.
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFeedback("preparing");
    try {
      const result = await window.rotk.reportCrash();
      if (!mounted.current) return;
      setFeedback(result.cancelled ? null : result.ok && result.value?.fileName ? "ready" : "failed");
    } catch {
      if (mounted.current) setFeedback("failed");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    setFeedback(null);
    buttonRef.current?.focus();
  }, []);

  const retry = useCallback(() => {
    // The retry control disappears while preparing; retain a stable keyboard target.
    buttonRef.current?.focus();
    void reportCrash();
  }, [reportCrash]);

  return { feedback, busy, buttonRef, reportCrash, dismiss, retry };
}

export function CrashReportFeedback({ feedback, onDismiss, onRetry }: {
  feedback: Feedback;
  onDismiss(): void;
  onRetry(): void;
}) {
  const { copy } = useI18n();
  if (!feedback) return null;
  const text = copy.diagnostics;

  return (
    <aside
      className={`crash-report-feedback is-${feedback}`}
      role={feedback === "failed" ? "alert" : "status"}
      aria-atomic="true"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); onDismiss(); }
      }}
    >
      {feedback === "preparing" ? <LoaderCircle size={18} className="crash-report-feedback__spinner" aria-hidden="true" />
        : feedback === "ready" ? <Check size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
      <div>
        <p>{text[feedback]}</p>
        {feedback === "failed" && <button type="button" className="crash-report-feedback__retry" onClick={onRetry}>{text.retry}</button>}
      </div>
      <button type="button" className="crash-report-feedback__close" aria-label={text.close} onClick={onDismiss}><X size={16} aria-hidden="true" /></button>
    </aside>
  );
}
