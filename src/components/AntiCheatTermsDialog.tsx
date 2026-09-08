import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { FAIRPLAY_TERMS, FAIRPLAY_TERMS_VERSION } from "../../shared/fairplay-terms";
import { useI18n } from "../i18n";
import "./AntiCheatTermsDialog.css";

export function AntiCheatTermsDialog({ open, accepted, busy, onClose, onAccept }: {
  open: boolean; accepted: boolean; busy: boolean; onClose(): void; onAccept(): void;
}) {
  const { locale } = useI18n();
  const copy = FAIRPLAY_TERMS[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    const previous = document.activeElement as HTMLElement | null;
    setChecked(false);
    element.showModal();
    element.querySelector<HTMLElement>(".anti-cheat-terms__body")?.scrollTo(0, 0);
    return () => { element.close(); previous?.focus(); };
  }, [open]);
  return <dialog ref={dialog} className="anti-cheat-terms" aria-labelledby="anti-cheat-terms-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><ShieldCheck size={26}/><div><h2 id="anti-cheat-terms-title">{copy.title}</h2><p>{copy.intro}</p></div></header>
    <div className="anti-cheat-terms__body" tabIndex={0}>
      {copy.sections.map(section => <section key={section.title}><h3>{section.title}</h3><p>{section.text}</p></section>)}
      <button type="button" className="anti-cheat-terms__link" onClick={() => void window.rotk.openWebsite("/privacy")}>{copy.privacy}</button>
      <small>{FAIRPLAY_TERMS_VERSION}</small>
    </div>
    <footer>
      {accepted ? <p>{copy.saved}</p> : <label><input type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)}/><span>{copy.agreement}</span></label>}
      <div><button type="button" disabled={busy} onClick={onClose}>{accepted ? copy.close : copy.cancel}</button>
        {!accepted && <button type="button" className="anti-cheat-terms__accept" disabled={!checked || busy} onClick={onAccept}>{copy.accept}</button>}</div>
    </footer>
  </dialog>;
}
