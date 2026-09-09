import type { AppLocale } from "../shared/locale";

export interface DiagnosticsCopy {
  action: string;
  preparing: string;
  ready: string;
  failed: string;
  retry: string;
  close: string;
  debug: {
    title: string;
    enable: string;
    description: string;
    enabled: string;
    saving: string;
    recording: string;
    preparing: string;
    ready: string;
    error: string;
    settingFailed: string;
  };
}

export const DIAGNOSTICS_COPY: Record<AppLocale, DiagnosticsCopy> = {
  en: {
    action: "My game crashed",
    preparing: "Preparing your report…",
    ready: "Your report is ready. Send the ZIP to the admin.",
    failed: "The report couldn’t be created.",
    retry: "Try again",
    close: "Dismiss report message",
    debug: {
      title: "Debug",
      enable: "Record my game session",
      description: "Enable before playing. A report will be prepared when the game closes.",
      enabled: "Debug is ready for your next game.",
      saving: "Saving…",
      recording: "Debug is active. Your game session is being recorded.",
      preparing: "Preparing your report…",
      ready: "Your report is ready. Send the ZIP to the admin.",
      error: "The report couldn’t be prepared. Use “My game crashed”.",
      settingFailed: "This setting couldn’t be saved. Try again.",
    },
  },
  fr: {
    action: "J’ai crashé",
    preparing: "Préparation du rapport…",
    ready: "Ton rapport est prêt. Envoie le ZIP à l’admin.",
    failed: "Le rapport n’a pas pu être créé.",
    retry: "Réessayer",
    close: "Fermer le message du rapport",
    debug: {
      title: "Debug",
      enable: "Enregistrer ma session de jeu",
      description: "À activer avant de jouer. Un rapport sera préparé à la fermeture du jeu.",
      enabled: "Debug prêt pour ta prochaine partie.",
      saving: "Enregistrement…",
      recording: "Debug actif. Ta session de jeu est enregistrée.",
      preparing: "Préparation du rapport…",
      ready: "Ton rapport est prêt. Envoie le ZIP à l’admin.",
      error: "Le rapport n’a pas pu être préparé. Utilise « J’ai crashé ».",
      settingFailed: "Ce réglage n’a pas pu être enregistré. Réessaie.",
    },
  },
};
