import { useCallback, useEffect, useState } from "react";
import type { LauncherSnapshot, OperationResult } from "../shared/contracts";
import { InstallPanel } from "./components/InstallPanel";
import { LauncherFooter } from "./components/LauncherFooter";
import { NewsCarousel } from "./components/NewsCarousel";
import { PlayerIdentityPanel } from "./components/PlayerIdentityPanel";
import { UpdateBanner } from "./components/UpdateBanner";
import { WindowChrome } from "./components/WindowChrome";
import { useI18n } from "./i18n";

export default function App() {
  const { locale, copy } = useI18n();
  const [snapshot, setSnapshot] = useState<LauncherSnapshot | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transientError, setTransientError] = useState<string | null>(null);

  useEffect(() => {
    setTransientError(null);
  }, [locale]);

  useEffect(() => {
    let mounted = true;
    void window.rotk.getSnapshot().then((value) => {
      if (!mounted) return;
      setSnapshot(value);
      if (!value.installationRoot) setSetupOpen(true);
      else if (!value.playerIdentity.configured) setIdentityOpen(true);
    });
    const unsubscribe = window.rotk.onSnapshot((value) => {
      setSnapshot(value);
      if (value.phase === "installing") {
        setIdentityOpen(false);
        setSetupOpen(true);
      }
      if (value.phase === "ready" && value.installationRoot) {
        setSetupOpen(false);
        if (!value.playerIdentity.configured) setIdentityOpen(true);
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const perform = useCallback(async (operation: () => Promise<OperationResult<unknown>>) => {
    setBusy(true);
    setTransientError(null);
    try {
      const result = await operation();
      if (!result.ok && !result.cancelled) setTransientError(result.error ?? copy.app.operationFailed);
    } finally {
      setBusy(false);
    }
  }, [copy.app.operationFailed]);

  if (!snapshot) {
    return (
      <main className="boot-screen">
        <img src="./branding/rotk-mark.svg" alt="ROTK" />
        <span>{copy.app.initializing}</span>
      </main>
    );
  }

  const selectSource = () => perform(() => window.rotk.selectSource());
  const selectDestination = () => perform(() => window.rotk.selectDestination());
  const install = () => perform(() => window.rotk.install());
  const play = () => perform(() => window.rotk.play());
  const onPrimary = () => {
    if (snapshot.canPlay) void play();
    else if (snapshot.installationRoot && !snapshot.playerIdentity.configured) {
      setSetupOpen(false);
      setIdentityOpen(true);
    } else setSetupOpen(true);
  };

  return (
    <main className="launcher-shell">
      <WindowChrome appVersion={snapshot.appVersion} />
      <NewsCarousel updates={snapshot.updates} />
      {(transientError || snapshot.error) && (
        <div className="error-toast" role="alert">
          <strong>{copy.app.operationInterrupted}</strong>
          <span>{snapshot.error ?? transientError}</span>
          <button type="button" aria-label={copy.app.closeError} onClick={() => setTransientError(null)}>×</button>
        </div>
      )}
      <UpdateBanner
        snapshot={snapshot}
        busy={busy}
        onDownload={() => void perform(() => window.rotk.downloadLauncherUpdate())}
        onInstall={() => void perform(() => window.rotk.installLauncherUpdate())}
      />
      <LauncherFooter
        snapshot={snapshot}
        busy={busy}
        onPrimary={onPrimary}
        onSetup={() => {
          setIdentityOpen(false);
          setSetupOpen(true);
        }}
        onIdentity={() => {
          setSetupOpen(false);
          setIdentityOpen(true);
        }}
      />
      <PlayerIdentityPanel
        snapshot={snapshot}
        open={identityOpen}
        onClose={() => setIdentityOpen(false)}
      />
      <InstallPanel
        snapshot={snapshot}
        open={setupOpen}
        busy={busy}
        onClose={() => setSetupOpen(false)}
        onSelectSource={() => void selectSource()}
        onSelectDestination={() => void selectDestination()}
        onInstall={() => void install()}
        onCancel={() => void window.rotk.cancelInstall()}
      />
    </main>
  );
}
