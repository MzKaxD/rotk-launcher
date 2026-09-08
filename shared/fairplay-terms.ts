import type { AppLocale } from "./locale.js";

/** Changing the scope or wording requires a new version and explicit acceptance. */
export const FAIRPLAY_TERMS_VERSION = "2026-09-08.1";
export interface FairPlayTermsAcceptance { version: string; acceptedAt: string }
export const FAIRPLAY_TERMS: Record<AppLocale, {
  title: string; intro: string; sections: { title: string; text: string }[];
  agreement: string; accept: string; cancel: string; close: string; privacy: string; saved: string;
}> = {
  en: {
    title: "ROTK Anti-Cheat",
    intro: "Read and accept these conditions before playing on ROTK servers.",
    sections: [
      { title: "Checks during your game", text: "ROTK Anti-Cheat checks the game, launcher and anti-cheat file hashes, loaded DLLs and executable-memory anomalies. Technical findings are sent to ROTK for manual review." },
      { title: "Checks requested by administrators", text: "While the game is running, authorized senior administrators may request a screenshot of the foreground game window and a list of open executable names and process IDs. Your acceptance authorizes these requests without another approval pop-up. A game screenshot can include chat and overlays inside the game window." },
      { title: "Collection stays limited", text: "No desktop or other windows, personal documents, file paths, command lines, keystrokes or memory contents are collected by ROTK Anti-Cheat. It stops collecting when you close the game. It does not run as a background service." },
      { title: "Use and retention", text: "Evidence is used to investigate cheating. Administrator requests and access are logged. Requested screenshots and process lists are accessible for 24 hours; sessions and alerts for 14 days; access history for 30 days. Missing checks do not close the game in observation mode and findings do not automatically ban players." },
    ],
    agreement: "I accept these conditions, including administrator-requested game screenshots and process lists during my games.",
    accept: "Accept and play", cancel: "Cancel", close: "Close", privacy: "Full privacy policy",
    saved: "Accepted for this account on this launcher. You will be asked again if these conditions change.",
  },
  fr: {
    title: "ROTK Anti-Cheat",
    intro: "Lisez et acceptez ces conditions avant de jouer sur les serveurs ROTK.",
    sections: [
      { title: "Vérifications pendant la partie", text: "ROTK Anti-Cheat vérifie les empreintes du jeu, du launcher et de l’anti-cheat, les DLL chargées et les anomalies de mémoire exécutable. Les observations techniques sont transmises à ROTK pour une analyse humaine." },
      { title: "Vérifications demandées par les administrateurs", text: "Pendant que le jeu est ouvert, les administrateurs habilités au plus haut niveau peuvent demander une capture de la fenêtre du jeu au premier plan et la liste des noms des exécutables ouverts avec leurs identifiants de processus. Votre acceptation autorise ces demandes sans nouvelle fenêtre de confirmation. Une capture peut inclure le chat et les overlays affichés dans le jeu." },
      { title: "Une collecte limitée", text: "ROTK Anti-Cheat ne collecte ni bureau, ni autres fenêtres, ni documents personnels, chemins de fichiers, lignes de commande, frappes clavier ou contenu de la mémoire. La collecte s’arrête à la fermeture du jeu. Aucun service permanent ne tourne en arrière-plan." },
      { title: "Utilisation et conservation", text: "Les éléments servent à enquêter sur la triche. Les demandes et accès des administrateurs sont journalisés. Les captures et listes demandées sont accessibles 24 heures ; les sessions et alertes, 14 jours ; l’historique des accès, 30 jours. En mode observation, une vérification manquante ne ferme pas le jeu et les signalements ne bannissent pas automatiquement les joueurs." },
    ],
    agreement: "J’accepte ces conditions, y compris les captures du jeu et listes de processus demandées par les administrateurs pendant mes parties.",
    accept: "Accepter et jouer", cancel: "Annuler", close: "Fermer", privacy: "Politique de confidentialité complète",
    saved: "Accord enregistré pour ce compte sur ce launcher. Il sera redemandé si ces conditions changent.",
  },
};

export function isCurrentTermsAcceptance(value: unknown): value is FairPlayTermsAcceptance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<FairPlayTermsAcceptance>;
  return receipt.version === FAIRPLAY_TERMS_VERSION && typeof receipt.acceptedAt === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.acceptedAt)
    && Number.isFinite(Date.parse(receipt.acceptedAt))
    && new Date(receipt.acceptedAt).toISOString() === receipt.acceptedAt;
}
