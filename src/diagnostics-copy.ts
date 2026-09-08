import type { AppLocale } from "../shared/locale";

export interface DiagnosticsCopy {
  action: string;
  preparing: string;
  ready: string;
  failed: string;
  retry: string;
  close: string;
}

export const DIAGNOSTICS_COPY: Record<AppLocale, DiagnosticsCopy> = {
  en: {
    action: "My game crashed",
    preparing: "Preparing your report…",
    ready: "Your report is ready. Send the ZIP to the admin.",
    failed: "The report couldn’t be created.",
    retry: "Try again",
    close: "Dismiss report message",
  },
  fr: {
    action: "J’ai crashé",
    preparing: "Préparation du rapport…",
    ready: "Ton rapport est prêt. Envoie le ZIP à l’admin.",
    failed: "Le rapport n’a pas pu être créé.",
    retry: "Réessayer",
    close: "Fermer le message du rapport",
  },
};
