import { CircleAlert, Gauge, KeyRound, Play, RotateCcw, Settings2 } from "lucide-react";
import type { LauncherSnapshot } from "../../shared/contracts";
import { useI18n, type Copy } from "../i18n";

interface LauncherFooterProps {
  snapshot: LauncherSnapshot;
  busy: boolean;
  onPrimary(): void;
  onSetup(): void;
  onIdentity(): void;
}

function statusCopy(snapshot: LauncherSnapshot, copy: Copy): { label: string; detail: string } {
  if (snapshot.phase === "running") {
    return {
      label: copy.footer.inGame,
      detail: snapshot.gamePid ? `${copy.footer.process} ${snapshot.gamePid}` : copy.footer.activeProcess,
    };
  }
  if (snapshot.phase === "launching") {
    const assetProgress = snapshot.assetSync.progress;
    if (assetProgress && assetProgress.totalBytes > 0) {
      const percent = Math.min(100, Math.round((assetProgress.completedBytes / assetProgress.totalBytes) * 100));
      return { label: copy.footer.launching, detail: `${copy.assets.updating} — ${percent}%` };
    }
    return { label: copy.footer.launching, detail: copy.footer.preparingClient };
  }
  if (snapshot.phase === "installing") return { label: copy.footer.installing, detail: copy.footer.secureCopy };
  if (snapshot.error) return { label: copy.footer.attention, detail: snapshot.error };
  if (snapshot.phase === "ready" && !snapshot.playerIdentity.configured) {
    return { label: copy.footer.accountRequired, detail: copy.footer.missingAccountKey };
  }
  if (snapshot.phase === "ready") return { label: copy.footer.ready, detail: snapshot.installationRoot ?? copy.footer.clientConfigured };
  return { label: copy.footer.setupRequired, detail: copy.footer.createIndependentInstall };
}

export function LauncherFooter({ snapshot, busy, onPrimary, onSetup, onIdentity }: LauncherFooterProps) {
  const { copy } = useI18n();
  const status = statusCopy(snapshot, copy);
  const ready = snapshot.canPlay;
  const running = snapshot.phase === "running" || snapshot.phase === "launching";
  const installing = snapshot.phase === "installing";
  const needsAccountKey = snapshot.phase === "ready" && !snapshot.playerIdentity.configured;
  const primaryLabel = ready
    ? "PLAY"
    : running
      ? copy.footer.inGame
      : installing
        ? copy.footer.installing
        : needsAccountKey
          ? copy.footer.addAccountKey
          : copy.footer.install;
  const runtimeLabel = snapshot.runtime.environment === "development"
    ? copy.footer.developmentServer
    : snapshot.runtime.label;

  return (
    <footer className="launcher-footer">
      <div className="launcher-footer__status">
        <span className={`status-pulse ${snapshot.canPlay ? "is-ready" : ""}`} />
        <div>
          <strong>{status.label}</strong>
          <small title={status.detail}>{status.detail}</small>
        </div>
      </div>

      <div className="launcher-footer__server">
        <Gauge size={18} />
        <div>
          <span>{copy.footer.environment}</span>
          <strong>{runtimeLabel}</strong>
        </div>
        <i className={snapshot.runtime.environment === "development" ? "is-dev" : ""}>
          {snapshot.runtime.environment === "development" ? "DEV" : "LIVE"}
        </i>
      </div>

      <div className="footer-tools">
        <button type="button" onClick={onIdentity} disabled={installing} aria-label={copy.footer.playerIdentity} title={copy.footer.playerIdentity}>
          <KeyRound size={19} />
        </button>
        <button type="button" onClick={onSetup} disabled={installing} aria-label={copy.footer.settings} title={copy.footer.settings}>
          {snapshot.error ? <CircleAlert size={20} /> : snapshot.installationRoot ? <Settings2 size={20} /> : <RotateCcw size={20} />}
        </button>
      </div>

      <button
        type="button"
        className={`play-button ${ready ? "is-ready" : ""}`}
        disabled={busy || running || installing}
        onClick={onPrimary}
      >
        <span>{primaryLabel}</span>
        <Play size={24} fill="currentColor" />
      </button>
    </footer>
  );
}
