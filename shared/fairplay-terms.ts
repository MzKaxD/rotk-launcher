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
    intro: "Conditions for playing on ROTK servers.",
    sections: [
      { title: "Fair play", text: "ROTK Anti-Cheat helps keep games fair. During your game, it checks ROTK file hashes, loaded DLLs and technical anomalies. Findings are reviewed by authorized administrators." },
      { title: "Checks during a game", text: "Accepting allows senior administrators to request a screenshot of the foreground game window and the names and IDs of open processes, without another approval pop-up. Screenshots can include chat and overlays visible in the game." },
      { title: "Your privacy", text: "ROTK Anti-Cheat does not collect your desktop, other windows, personal documents, file paths, command lines, keystrokes or memory contents. Collection stops when you close the game. Declining these conditions cancels the launch." },
      { title: "Use of information", text: "Information is used to investigate cheating. Requested evidence is accessible for 24 hours; sessions and alerts for 14 days; administrator access logs for 30 days. In observation mode, unavailable checks do not close the game. Findings never automatically ban players." },
    ],
    agreement: "I accept these conditions, including administrator-requested game screenshots and process lists during my games.",
    accept: "Accept and play", cancel: "Cancel", close: "Close", privacy: "Full privacy policy",
    saved: "Accepted for this account on this launcher. You will be asked again if these conditions change.",
  },
  fr: {
    title: "ROTK Anti-Cheat",
    intro: "Conditions de jeu sur les serveurs ROTK.",
    sections: [
      { title: "Un jeu équitable", text: "ROTK Anti-Cheat contribue à garder des parties équitables. Pendant le jeu, il vérifie les empreintes des fichiers ROTK, les DLL chargées et les anomalies techniques. Les observations sont examinées par les administrateurs habilités." },
      { title: "Les vérifications en partie", text: "Votre accord permet aux administrateurs au plus haut niveau de demander une capture de la fenêtre du jeu au premier plan et les noms et identifiants des processus ouverts, sans nouvelle confirmation. Le chat et les overlays visibles dans le jeu peuvent apparaître sur les captures." },
      { title: "Votre vie privée", text: "ROTK Anti-Cheat ne collecte ni bureau, autres fenêtres, documents personnels, chemins de fichiers, lignes de commande, frappes clavier ou contenu mémoire. La collecte s’arrête à la fermeture du jeu. Refuser ces conditions annule le lancement." },
      { title: "L’utilisation des informations", text: "Les informations servent à enquêter sur la triche. Les éléments demandés sont accessibles 24 heures ; les sessions et alertes, 14 jours ; les accès administrateur, 30 jours. En observation, une vérification indisponible ne ferme pas le jeu. Aucun signalement ne bannit automatiquement." },
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
