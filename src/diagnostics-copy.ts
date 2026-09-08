import type { DiagnosticCaptureStatus, DiagnosticReportKind, DiagnosticReportStatus } from "../shared/diagnostics";
import type { AppLocale } from "../shared/locale";

export interface DiagnosticsCopy {
  reports: string;
  title: string;
  intro: string;
  close: string;
  refresh: string;
  loading: string;
  history: string;
  empty: string;
  emptyHint: string;
  selectReport: string;
  newCrash: string;
  openReport: string;
  dismiss: string;
  captureTitle: string;
  captureHint: string;
  capture: string;
  capturing: string;
  captureMode: string;
  standard: string;
  full: string;
  fullHint: string;
  launchToCapture: string;
  advanced: string;
  advancedToggle: string;
  advancedHint: string;
  advancedLocked: string;
  date: string;
  duration: string;
  exitCode: string;
  dumps: string;
  size: string;
  captureStatus: string;
  noCode: string;
  unknown: string;
  live: string;
  fullIncluded: string;
  notes: string;
  notesPlaceholder: string;
  includeDumps: string;
  privacy: string;
  localOnly: string;
  export: string;
  exporting: string;
  openFolder: string;
  partial: string;
  missingDump: string;
  recordingHint: string;
  collectingHint: string;
  interruptedHint: string;
  failedLoad: string;
  failedCapture: string;
  failedExport: string;
  failedFolder: string;
  failedSetting: string;
  cancelled: string;
  captured: string;
  settingSaved: string;
  folderOpened: string;
  exported: (fileName: string) => string;
  kind: Record<DiagnosticReportKind, string>;
  status: Record<DiagnosticReportStatus, string>;
  captureStates: Record<DiagnosticCaptureStatus, string>;
}

export const DIAGNOSTICS_COPY: Record<AppLocale, DiagnosticsCopy> = {
  en: {
    reports: "Reports", title: "GAME REPORTS",
    intro: "Review recent sessions and save a diagnostic ZIP to share with support.",
    close: "Close game reports", refresh: "Refresh", loading: "Loading reports…",
    history: "SESSION HISTORY", empty: "No reports yet",
    emptyHint: "Your next game session will appear here. Reports stay available after restarting the launcher.",
    selectReport: "Select a session to review its report.", newCrash: "A game incident was recorded.",
    openReport: "Open report", dismiss: "Dismiss report notification",
    captureTitle: "GAME FROZEN?", captureHint: "Capture the game while it is still running. Add context before exporting.",
    capture: "Capture now", capturing: "Capturing…", captureMode: "Capture detail",
    standard: "Standard dump", full: "Full memory dump",
    fullHint: "A full dump can take several GB and briefly pause the game during capture.",
    launchToCapture: "Available while a game launched here is running.",
    advanced: "Advanced capture", advancedToggle: "Capture crashes automatically",
    advancedHint: "Applies to the next game launch. Session reports remain available when disabled.",
    advancedLocked: "Close the game before changing this setting.",
    date: "Started", duration: "Duration", exitCode: "Exit code", dumps: "Memory dumps",
    size: "Report size", captureStatus: "Crash capture", noCode: "Not available", unknown: "—",
    live: "In progress", fullIncluded: "Full dump included",
    notes: "What happened?", notesPlaceholder: "What were you doing? Map, action, error message, or steps to reproduce…",
    includeDumps: "Include available memory dumps", privacy: "Memory dumps may contain session data. Review who you share them with.",
    localOnly: "Saved locally. Nothing is uploaded automatically.", export: "Export ZIP", exporting: "Exporting…",
    openFolder: "Open reports folder", partial: "Some information could not be collected. The available report can still be exported.",
    missingDump: "No memory dump is available. Logs and session information can still help investigate.",
    recordingHint: "This session is still running. Capture now to inspect a freeze, or export the information available so far.",
    collectingHint: "Finishing the report. The list updates automatically when it is ready.",
    interruptedHint: "The previous session did not finish recording. Available information was recovered after restarting the launcher.",
    failedLoad: "Reports could not be loaded. Try refreshing.", failedCapture: "Capture failed. Keep the game open and try again.",
    failedExport: "The ZIP could not be saved. Refresh the report and try another save location.",
    failedFolder: "The reports folder could not be opened.", failedSetting: "The capture setting could not be saved. Try again.",
    cancelled: "Cancelled. No ZIP was saved.", captured: "Capture saved. Select the report below to export it.",
    settingSaved: "Capture preference saved for the next game launch.", folderOpened: "Reports folder opened.",
    exported: (fileName) => `Saved: ${fileName}`,
    kind: { crash: "Crash", exit: "Game session", interrupted: "Interrupted session", manual: "Manual capture", "launch-error": "Launch failed" },
    status: { recording: "Recording", collecting: "Collecting", ready: "Ready", partial: "Partial report" },
    captureStates: { pending: "Preparing", attached: "Active", unavailable: "Unavailable", disabled: "Disabled", finished: "Finished" },
  },
  fr: {
    reports: "Rapports", title: "RAPPORTS DE JEU",
    intro: "Consulte tes dernières sessions et enregistre un ZIP de diagnostic à partager avec le support.",
    close: "Fermer les rapports de jeu", refresh: "Actualiser", loading: "Chargement des rapports…",
    history: "HISTORIQUE DES SESSIONS", empty: "Aucun rapport pour le moment",
    emptyHint: "Ta prochaine session apparaîtra ici. Les rapports restent accessibles après le redémarrage du launcher.",
    selectReport: "Sélectionne une session pour consulter son rapport.", newCrash: "Un incident de jeu a été enregistré.",
    openReport: "Ouvrir le rapport", dismiss: "Masquer la notification de rapport",
    captureTitle: "JEU BLOQUÉ ?", captureHint: "Capture le jeu pendant qu’il tourne encore. Ajoute le contexte avant l’export.",
    capture: "Capturer maintenant", capturing: "Capture en cours…", captureMode: "Détail de la capture",
    standard: "Dump standard", full: "Dump mémoire complet",
    fullHint: "Un dump complet peut peser plusieurs Go et suspend brièvement le jeu pendant la capture.",
    launchToCapture: "Disponible quand un jeu lancé ici est en cours.",
    advanced: "Capture avancée", advancedToggle: "Capturer automatiquement les crashs",
    advancedHint: "S’applique au prochain lancement du jeu. Les rapports de session restent disponibles si désactivé.",
    advancedLocked: "Ferme le jeu avant de modifier ce réglage.",
    date: "Début", duration: "Durée", exitCode: "Code de sortie", dumps: "Dumps mémoire",
    size: "Taille du rapport", captureStatus: "Capture des crashs", noCode: "Indisponible", unknown: "—",
    live: "En cours", fullIncluded: "Dump complet inclus",
    notes: "Que s’est-il passé ?", notesPlaceholder: "Que faisais-tu ? Carte, action, message d’erreur ou étapes pour reproduire…",
    includeDumps: "Inclure les dumps mémoire disponibles", privacy: "Les dumps mémoire peuvent contenir des données de session. Vérifie à qui tu les transmets.",
    localOnly: "Enregistré localement. Aucun envoi automatique.", export: "Exporter le ZIP", exporting: "Export en cours…",
    openFolder: "Ouvrir le dossier des rapports", partial: "Certaines informations n’ont pas pu être collectées. Le rapport disponible reste exportable.",
    missingDump: "Aucun dump mémoire disponible. Les journaux et les informations de session peuvent tout de même aider au diagnostic.",
    recordingHint: "Cette session est encore en cours. Capture maintenant pour examiner un blocage, ou exporte les informations déjà disponibles.",
    collectingHint: "Finalisation du rapport. La liste s’actualise automatiquement dès qu’il est prêt.",
    interruptedHint: "L’enregistrement de la session précédente a été interrompu. Les informations disponibles ont été récupérées au redémarrage du launcher.",
    failedLoad: "Impossible de charger les rapports. Essaie d’actualiser.", failedCapture: "La capture a échoué. Garde le jeu ouvert et réessaie.",
    failedExport: "Impossible d’enregistrer le ZIP. Actualise le rapport et essaie un autre emplacement.",
    failedFolder: "Impossible d’ouvrir le dossier des rapports.", failedSetting: "Impossible d’enregistrer le réglage de capture. Réessaie.",
    cancelled: "Annulé. Aucun ZIP n’a été enregistré.", captured: "Capture enregistrée. Sélectionne le rapport ci-dessous pour l’exporter.",
    settingSaved: "Préférence de capture enregistrée pour le prochain lancement du jeu.", folderOpened: "Dossier des rapports ouvert.",
    exported: (fileName) => `Enregistré : ${fileName}`,
    kind: { crash: "Crash", exit: "Session de jeu", interrupted: "Session interrompue", manual: "Capture manuelle", "launch-error": "Échec du lancement" },
    status: { recording: "Enregistrement", collecting: "Collecte en cours", ready: "Prêt", partial: "Rapport partiel" },
    captureStates: { pending: "Préparation", attached: "Active", unavailable: "Indisponible", disabled: "Désactivée", finished: "Terminée" },
  },
};
