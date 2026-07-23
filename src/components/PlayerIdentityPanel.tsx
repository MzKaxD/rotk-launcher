import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, ExternalLink, Eye, EyeOff, KeyRound, ShieldCheck, X } from "lucide-react";
import type { LauncherSnapshot, OperationResult, PlayerIdentitySummary } from "../../shared/contracts";
import { isValidPlayerKey, normalizePlayerKey, PLAYER_KEY_HEX_LENGTH } from "../../shared/player-key";
import { useI18n } from "../i18n";

interface PlayerIdentityPanelProps {
  snapshot: LauncherSnapshot;
  open: boolean;
  onClose(): void;
}

type Feedback = { tone: "success" | "error"; text: string } | null;

export function PlayerIdentityPanel({ snapshot, open, onClose }: PlayerIdentityPanelProps) {
  const { copy } = useI18n();
  const [draft, setDraft] = useState(snapshot.playerIdentity.playerKey ?? "");
  const [visible, setVisible] = useState(false);
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const locked = snapshot.phase === "launching" || snapshot.phase === "running";
  const normalizedDraft = useMemo(() => normalizePlayerKey(draft), [draft]);
  const valid = isValidPlayerKey(draft);
  const dirty = normalizedDraft !== (snapshot.playerIdentity.playerKey ?? "");

  useEffect(() => {
    setDraft(snapshot.playerIdentity.playerKey ?? "");
  }, [snapshot.playerIdentity.playerKey]);

  useEffect(() => {
    if (!open) return;
    setVisible(false);
    setFeedback(null);
  }, [open]);

  async function run(
    operation: () => Promise<OperationResult<PlayerIdentitySummary>>,
    successMessage: string,
  ): Promise<void> {
    setWorking(true);
    setFeedback(null);
    try {
      const result = await operation();
      if (!result.ok || !result.value) {
        setFeedback({ tone: "error", text: result.error ?? copy.app.operationFailed });
        return;
      }
      setDraft(result.value.playerKey ?? "");
      setFeedback({ tone: "success", text: successMessage });
    } catch {
      setFeedback({ tone: "error", text: copy.app.operationFailed });
    } finally {
      setWorking(false);
    }
  }

  function applyPlayerKey(): void {
    if (!valid) {
      setFeedback({ tone: "error", text: copy.identity.invalid });
      return;
    }
    void run(() => window.rotk.setPlayerKey(normalizedDraft), copy.identity.applied);
  }

  async function copyPlayerKey(): Promise<void> {
    setWorking(true);
    setFeedback(null);
    try {
      const result = await window.rotk.copyPlayerKey();
      setFeedback(result.ok
        ? { tone: "success", text: copy.identity.copied }
        : { tone: "error", text: result.error ?? copy.app.operationFailed });
    } catch {
      setFeedback({ tone: "error", text: copy.app.operationFailed });
    } finally {
      setWorking(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            className="install-panel__backdrop"
            aria-label={copy.identity.close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={working ? undefined : onClose}
          />
          <motion.aside
            className="identity-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
            aria-label={copy.identity.panelLabel}
          >
            <div className="install-panel__topline" />
            <header className="identity-panel__header">
              <div>
                <span className="eyebrow">{copy.identity.eyebrow}</span>
                <h2>{copy.identity.title}</h2>
              </div>
              <button type="button" className="panel-close" aria-label={copy.identity.close} onClick={onClose}>
                <X size={19} />
              </button>
            </header>

            <p className="identity-panel__intro">{copy.identity.intro}</p>

            <div className="identity-session-note">
              <ShieldCheck size={20} />
              <span>{copy.identity.sessionOnly}</span>
            </div>

            <div className="identity-account-guide">
              <span>01</span>
              <p>{copy.identity.process}</p>
              <button type="button" onClick={() => void window.rotk.openWebsite("/login")}>
                {copy.identity.openAccount}
                <ExternalLink size={15} />
              </button>
            </div>

            <form
              className="identity-form"
              onSubmit={(event) => {
                event.preventDefault();
                applyPlayerKey();
              }}
            >
              <label htmlFor="player-key">{copy.identity.keyLabel}</label>
              <div className={`identity-key-field ${feedback?.tone === "error" ? "has-error" : ""}`}>
                <KeyRound size={18} />
                <input
                  id="player-key"
                  type={visible ? "text" : "password"}
                  value={draft}
                  maxLength={PLAYER_KEY_HEX_LENGTH}
                  placeholder={copy.identity.placeholder}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={locked || working}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setFeedback(null);
                  }}
                />
                <span className="identity-key-field__count">{draft.length}/{PLAYER_KEY_HEX_LENGTH}</span>
                <button
                  type="button"
                  aria-label={visible ? copy.identity.hide : copy.identity.show}
                  title={visible ? copy.identity.hide : copy.identity.show}
                  onClick={() => setVisible((current) => !current)}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
                <button
                  type="button"
                  aria-label={copy.identity.copy}
                  title={copy.identity.copy}
                  disabled={working || dirty || !snapshot.playerIdentity.configured}
                  onClick={() => void copyPlayerKey()}
                >
                  <Copy size={17} />
                </button>
              </div>

              <div className="identity-actions">
                <button
                  type="submit"
                  className="identity-actions__apply"
                  disabled={locked || working || !dirty || !valid}
                >
                  {copy.identity.apply}
                </button>
              </div>
            </form>

            <div className={`identity-feedback ${feedback ? `is-${feedback.tone}` : ""}`} aria-live="polite">
              {feedback?.text ?? "\u00a0"}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
