import { useState } from "react";
import { Download } from "lucide-react";
import type { LauncherSnapshot } from "../../shared/contracts";
import { useI18n } from "../i18n";

interface UpdateBannerProps {
  snapshot: LauncherSnapshot;
  busy: boolean;
  onDownload(): void;
  onInstall(): void;
}

export function UpdateBanner({ snapshot, busy, onDownload, onInstall }: UpdateBannerProps) {
  const { copy } = useI18n();
  const [dismissed, setDismissed] = useState(false);
  const update = snapshot.launcherUpdate;

  const visible =
    update.status === "update-available"
    || update.status === "downloading"
    || update.status === "downloaded"
    || (update.status === "error" && update.error !== null);
  if (!visible || dismissed || !update.availableVersion) return null;

  const version = `v${update.availableVersion}`;
  const label =
    update.status === "downloading"
      ? copy.update.downloading
      : update.status === "downloaded"
        ? copy.update.restart
        : update.status === "error"
          ? copy.update.failed
          : copy.update.available(version);
  const detail =
    update.status === "error"
      ? update.error ?? ""
      : update.status === "downloaded"
        ? copy.update.restartDetail
        : update.status === "downloading"
          ? version
          : copy.update.availableDetail;

  return (
    <aside className="update-banner" role="status">
      <Download size={18} />
      <div className="update-banner__text">
        <strong>{label}</strong>
        <small title={detail}>{detail}</small>
        {update.status === "downloading" && (
          <span className="update-banner__progress">
            <i style={{ width: `${update.progressPercent ?? 0}%` }} />
          </span>
        )}
      </div>
      {update.status === "update-available" && (
        <button type="button" disabled={busy} onClick={onDownload}>
          {copy.update.download}
        </button>
      )}
      {update.status === "error" && (
        <button type="button" disabled={busy} onClick={onDownload}>
          {copy.update.retry}
        </button>
      )}
      {update.status === "downloaded" && (
        <button type="button" disabled={busy} onClick={onInstall}>
          {copy.update.restart}
        </button>
      )}
      <button
        type="button"
        className="update-banner__dismiss"
        aria-label={copy.update.dismiss}
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </aside>
  );
}
