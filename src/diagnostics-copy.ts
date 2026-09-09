import type { AppLocale } from "../shared/locale";

export interface DiagnosticsCopy {
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
    debug: {
      title: "Debug",
      enable: "Debug and send session reports",
      description: "Enable before playing to send technical logs, performance data and available memory dumps privately to ROTK after each game. Dumps may contain private data. No screen or microphone recording. Reports are deleted after 7 days. Turn off after testing.",
      enabled: "Debug is ready for your next game.",
      saving: "Saving…",
      recording: "Debug is active. Your game session is being recorded.",
      preparing: "Preparing and sending your report…",
      ready: "Report received by ROTK. You can share this reference with an admin:",
      error: "Report not sent. Your evidence is kept locally. Restart the launcher to retry.",
      settingFailed: "This setting couldn’t be saved. Try again.",
    },
  },
  fr: {
    debug: {
      title: "Debug",
      enable: "Debug et envoi des rapports",
      description: "À activer avant de jouer pour envoyer à ROTK, en privé après chaque partie, les logs techniques, les performances et les dumps mémoire disponibles. Les dumps peuvent contenir des données privées. Aucun enregistrement de l’écran ou du micro. Rapports supprimés après 7 jours. Désactive après les essais.",
      enabled: "Debug prêt pour ta prochaine partie.",
      saving: "Enregistrement…",
      recording: "Debug actif. Ta session de jeu est enregistrée.",
      preparing: "Préparation et envoi du rapport…",
      ready: "Rapport reçu par ROTK. Tu peux communiquer cette référence à un admin :",
      error: "Rapport non envoyé. Les données restent sur ton PC. Relance le launcher pour réessayer.",
      settingFailed: "Ce réglage n’a pas pu être enregistré. Réessaie.",
    },
  },
};
