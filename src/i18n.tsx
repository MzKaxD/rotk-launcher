import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { isAppLocale, type AppLocale } from "../shared/locale";

const STORAGE_KEY = "rotk.launcher.locale";

export interface Copy {
  language: {
    label: string;
    change: (current: string) => string;
    english: string;
    french: string;
  };
  chrome: {
    launcher: string;
    updates: string;
    build: string;
    minimize: string;
    close: string;
  };
  app: {
    initializing: string;
    operationFailed: string;
    operationInterrupted: string;
    closeError: string;
  };
  news: {
    fallbackSummary: string;
    fallbackCategory: string;
    label: string;
    navigation: string;
    showItem: (index: number) => string;
    patchNote: string;
    devUpdate: string;
    version: string;
    readUpdate: string;
    previous: string;
    next: string;
  };
  footer: {
    inGame: string;
    process: string;
    activeProcess: string;
    launching: string;
    preparingClient: string;
    installing: string;
    secureCopy: string;
    attention: string;
    ready: string;
    clientConfigured: string;
    accountRequired: string;
    missingAccountKey: string;
    setupRequired: string;
    createIndependentInstall: string;
    install: string;
    environment: string;
    developmentServer: string;
    settings: string;
    playerIdentity: string;
    addAccountKey: string;
  };
  identity: {
    panelLabel: string;
    eyebrow: string;
    title: string;
    intro: string;
    keyLabel: string;
    placeholder: string;
    sessionOnly: string;
    process: string;
    openAccount: string;
    invalid: string;
    applied: string;
    copied: string;
    apply: string;
    copy: string;
    show: string;
    hide: string;
    close: string;
  };
  update: {
    available: (version: string) => string;
    availableDetail: string;
    download: string;
    downloading: string;
    restart: string;
    restartDetail: string;
    failed: string;
    retry: string;
    dismiss: string;
  };
  install: {
    notSelected: string;
    closeSetup: string;
    panelLabel: string;
    firstInstall: string;
    title: string;
    close: string;
    intro: string;
    protectionActive: string;
    protectionDetail: string;
    isolatedDetected: string;
    isolatedDetail: string;
    steamDetected: string;
    steamDetail: string;
    sourceClient: string;
    rotkInstall: string;
    detectedBadge: string;
    recommendedBadge: string;
    subfolderHint: string;
    choose: string;
    cancelCopy: string;
    createInstall: string;
    useExisting: string;
    legal: string;
    progressPhases: Record<"scanning" | "copying" | "verifying" | "configuring" | "finalizing", string>;
    progressFiles: Record<"scanning" | "verifying" | "configuring" | "finalizing", string>;
  };
  activity: {
    regionLabel: string;
    eyebrow: string;
    installation: string;
    assets: string;
    integrity: string;
    launch: string;
    launcherUpdate: string;
    checkingUpdate: string;
    checkingAssets: string;
    preparingFiles: string;
    integrityDetail: string;
    launchDetail: string;
    updateDetail: string;
    working: string;
    files: (completed: number, total: number) => string;
    packs: (completed: number, total: number) => string;
    progress: (operation: string) => string;
  };
  integrity: {
    verifying: string;
  };
  assets: {
    title: string;
    description: string;
    updating: string;
    status: Record<"idle" | "disabled" | "checking" | "downloading" | "installing" | "up-to-date" | "warning" | "error", string>;
    packVersion: (version: string) => string;
    neverSynced: string;
    warnings: Record<"feed-unavailable" | "sync-failed", string>;
    verify: string;
    restore: string;
    autoSync: string;
  };
}

const COPY: Record<AppLocale, Copy> = {
  en: {
    language: {
      label: "Language",
      change: (current) => `Change language. Current language: ${current}`,
      english: "English",
      french: "Français",
    },
    chrome: {
      launcher: "LAUNCHER",
      updates: "DEV UPDATES",
      build: "BUILD",
      minimize: "Minimize",
      close: "Close",
    },
    app: {
      initializing: "INITIALIZING LAUNCHER",
      operationFailed: "The operation failed.",
      operationInterrupted: "OPERATION INTERRUPTED",
      closeError: "Close",
    },
    news: {
      fallbackSummary: "The development feed is temporarily unavailable. The launcher remains available offline.",
      fallbackCategory: "DEVELOPMENT",
      label: "Latest ROTK news",
      navigation: "News navigation",
      showItem: (index) => `Show news item ${index}`,
      patchNote: "PATCH NOTE",
      devUpdate: "DEV UPDATE",
      version: "VERSION",
      readUpdate: "READ UPDATE",
      previous: "Previous news item",
      next: "Next news item",
    },
    footer: {
      inGame: "IN GAME",
      process: "PROCESS",
      activeProcess: "ACTIVE PROCESS",
      launching: "LAUNCHING",
      preparingClient: "PREPARING CLIENT",
      installing: "INSTALLING",
      secureCopy: "SECURE COPY IN PROGRESS",
      attention: "ATTENTION",
      ready: "READY",
      clientConfigured: "ROTK CLIENT CONFIGURED",
      accountRequired: "ROTK ACCOUNT REQUIRED",
      missingAccountKey: "ADD YOUR WEBSITE LAUNCHER KEY",
      setupRequired: "SETUP REQUIRED",
      createIndependentInstall: "SELECT AN H1Z1 CLIENT",
      install: "INSTALL",
      environment: "ENVIRONMENT",
      developmentServer: "Development server",
      settings: "Installation and settings",
      playerIdentity: "ROTK account key",
      addAccountKey: "ADD ROTK KEY",
    },
    identity: {
      panelLabel: "ROTK account authentication",
      eyebrow: "ROTK ACCOUNT",
      title: "LAUNCHER KEY",
      intro: "This key links every launch to your ROTK account, Steam identity and persistent game data.",
      keyLabel: "ROTK LAUNCHER KEY",
      placeholder: "32 hexadecimal characters",
      sessionOnly: "Saved with Windows encryption for this account. It is never generated by the launcher.",
      process: "Create or sign in to your account on rotk.app, open Avatar > Account settings > ROTK launcher key, then paste the key below.",
      openAccount: "OPEN ROTK.APP",
      invalid: "Enter exactly 32 hexadecimal characters (0-9, a-f).",
      applied: "ROTK account key saved securely.",
      copied: "ROTK account key copied.",
      apply: "SAVE KEY",
      copy: "Copy ROTK account key",
      show: "Show ROTK account key",
      hide: "Hide ROTK account key",
      close: "Close ROTK account authentication",
    },
    update: {
      available: (version) => `LAUNCHER UPDATE ${version} AVAILABLE`,
      availableDetail: "Downloaded securely from the official GitHub releases.",
      download: "UPDATE",
      downloading: "DOWNLOADING UPDATE",
      restart: "RESTART TO INSTALL",
      restartDetail: "The launcher restarts and installs the signed update.",
      failed: "UPDATE DOWNLOAD FAILED",
      retry: "RETRY",
      dismiss: "Hide update notification",
    },
    install: {
      notSelected: "NOT SELECTED",
      closeSetup: "Close setup",
      panelLabel: "ROTK client installation",
      firstInstall: "CLIENT SETUP",
      title: "CLIENT INSTALLATION",
      close: "Close",
      intro: "Choose the H1Z1 folder ROTK should use. A standalone client is configured in place; a Steam client is copied to a safe location first.",
      protectionActive: "AUTOMATIC DETECTION",
      protectionDetail: "Select a client to check whether it can be used directly.",
      isolatedDetected: "STANDALONE CLIENT DETECTED",
      isolatedDetail: "This client is already outside Steam. No copy is required.",
      steamDetected: "STEAM CLIENT DETECTED",
      steamDetail: "This installation will not be modified. Choose a destination outside Steam for the ROTK copy.",
      sourceClient: "H1Z1 CLIENT",
      rotkInstall: "ROTK INSTALLATION",
      detectedBadge: "AUTO-DETECTED",
      recommendedBadge: "RECOMMENDED",
      subfolderHint: "A ROTK subfolder is created automatically in the chosen location — no need to create it yourself.",
      choose: "CHOOSE",
      cancelCopy: "CANCEL",
      createInstall: "CREATE SEPARATE COPY",
      useExisting: "USE THIS CLIENT",
      legal: "The game is not downloaded or redistributed by ROTK. The copy only comes from your local files.",
      progressPhases: {
        scanning: "SCANNING",
        copying: "COPYING",
        verifying: "VERIFYING",
        configuring: "CONFIGURING",
        finalizing: "FINALIZING",
      },
      progressFiles: {
        scanning: "Scanning H1Z1 client",
        verifying: "SHA-256 verification",
        configuring: "Applying ROTK client configuration",
        finalizing: "Atomic finalization",
      },
    },
    activity: {
      regionLabel: "Launcher operations",
      eyebrow: "OPERATION IN PROGRESS",
      installation: "ROTK CLIENT INSTALLATION",
      assets: "ROTK GAME ASSETS",
      integrity: "GAME FILE VERIFICATION",
      launch: "GAME LAUNCH",
      launcherUpdate: "LAUNCHER UPDATE",
      checkingUpdate: "CHECKING FOR UPDATE",
      checkingAssets: "Checking the official asset feed",
      preparingFiles: "Preparing the H1Z1 client files",
      integrityDetail: "Checking every game file before launch",
      launchDetail: "Preparing the secure game session",
      updateDetail: "Contacting the official release feed",
      working: "WORKING",
      files: (completed, total) => `${completed} / ${total} files`,
      packs: (completed, total) => `${completed} / ${total} packs`,
      progress: (operation) => `${operation} progress`,
    },
    integrity: {
      verifying: "VERIFYING GAME FILES",
    },
    assets: {
      title: "CUSTOM ASSETS",
      description: "ROTK asset packs are downloaded from the official feed, verified with SHA-256 and updated before each launch.",
      updating: "UPDATING ASSETS",
      status: {
        idle: "NOT SYNCED YET",
        disabled: "SYNC DISABLED",
        checking: "CHECKING",
        downloading: "DOWNLOADING",
        installing: "INSTALLING",
        "up-to-date": "UP TO DATE",
        warning: "WARNING",
        error: "ERROR",
      },
      packVersion: (version) => `Asset pack ${version}`,
      neverSynced: "No asset pack installed",
      warnings: {
        "feed-unavailable": "Asset feed unreachable — playing with the assets already installed.",
        "sync-failed": "Asset update failed — playing with the assets already installed.",
      },
      verify: "VERIFY FILES",
      restore: "RESTORE VANILLA CLIENT",
      autoSync: "Update the custom assets automatically",
    },
  },
  fr: {
    language: {
      label: "Langue",
      change: (current) => `Changer de langue. Langue actuelle : ${current}`,
      english: "English",
      french: "Français",
    },
    chrome: {
      launcher: "LAUNCHER",
      updates: "DEV UPDATES",
      build: "BUILD",
      minimize: "Réduire",
      close: "Fermer",
    },
    app: {
      initializing: "INITIALISATION DU LAUNCHER",
      operationFailed: "L’opération a échoué.",
      operationInterrupted: "OPÉRATION INTERROMPUE",
      closeError: "Fermer",
    },
    news: {
      fallbackSummary: "Le flux de développement est momentanément indisponible. Le launcher reste utilisable hors ligne.",
      fallbackCategory: "DÉVELOPPEMENT",
      label: "Dernières actualités ROTK",
      navigation: "Navigation des actualités",
      showItem: (index) => `Afficher l’actualité ${index}`,
      patchNote: "PATCH NOTE",
      devUpdate: "DEV UPDATE",
      version: "VERSION",
      readUpdate: "LIRE L’UPDATE",
      previous: "Actualité précédente",
      next: "Actualité suivante",
    },
    footer: {
      inGame: "EN JEU",
      process: "PROCESSUS",
      activeProcess: "PROCESSUS ACTIF",
      launching: "LANCEMENT",
      preparingClient: "PRÉPARATION DU CLIENT",
      installing: "INSTALLATION",
      secureCopy: "COPIE SÉCURISÉE EN COURS",
      attention: "ATTENTION",
      ready: "PRÊT",
      clientConfigured: "CLIENT ROTK CONFIGURÉ",
      accountRequired: "COMPTE ROTK REQUIS",
      missingAccountKey: "AJOUTE TA CLÉ LAUNCHER DU SITE",
      setupRequired: "À CONFIGURER",
      createIndependentInstall: "SÉLECTIONNER UN CLIENT H1Z1",
      install: "INSTALLER",
      environment: "ENVIRONNEMENT",
      developmentServer: "Serveur de développement",
      settings: "Installation et réglages",
      playerIdentity: "Clé de compte ROTK",
      addAccountKey: "AJOUTER LA CLÉ ROTK",
    },
    identity: {
      panelLabel: "Authentification du compte ROTK",
      eyebrow: "COMPTE ROTK",
      title: "CLÉ LAUNCHER",
      intro: "Cette clé relie chaque lancement à ton compte ROTK, ton identité Steam et tes données de jeu persistantes.",
      keyLabel: "CLÉ LAUNCHER ROTK",
      placeholder: "32 caractères hexadécimaux",
      sessionOnly: "Enregistrée avec le chiffrement Windows de ce compte. Le launcher ne la génère jamais.",
      process: "Crée ou connecte ton compte sur rotk.app, ouvre Avatar > Account settings > ROTK launcher key, puis colle la clé ci-dessous.",
      openAccount: "OUVRIR ROTK.APP",
      invalid: "Saisis exactement 32 caractères hexadécimaux (0-9, a-f).",
      applied: "Clé de compte ROTK enregistrée de façon sécurisée.",
      copied: "Clé de compte ROTK copiée.",
      apply: "ENREGISTRER LA CLÉ",
      copy: "Copier la clé de compte ROTK",
      show: "Afficher la clé de compte ROTK",
      hide: "Masquer la clé de compte ROTK",
      close: "Fermer l’authentification du compte ROTK",
    },
    update: {
      available: (version) => `MISE À JOUR ${version} DISPONIBLE`,
      availableDetail: "Téléchargée de façon sécurisée depuis les releases GitHub officielles.",
      download: "METTRE À JOUR",
      downloading: "TÉLÉCHARGEMENT",
      restart: "REDÉMARRER POUR INSTALLER",
      restartDetail: "Le launcher redémarre et installe la mise à jour signée.",
      failed: "ÉCHEC DU TÉLÉCHARGEMENT",
      retry: "RÉESSAYER",
      dismiss: "Masquer la notification de mise à jour",
    },
    install: {
      notSelected: "NON SÉLECTIONNÉ",
      closeSetup: "Fermer la configuration",
      panelLabel: "Installation du client ROTK",
      firstInstall: "CONFIGURATION DU CLIENT",
      title: "INSTALLATION DU CLIENT",
      close: "Fermer",
      intro: "Choisis le dossier H1Z1 que ROTK doit utiliser. Un client isolé est configuré sur place ; un client Steam est d’abord copié vers un emplacement sûr.",
      protectionActive: "DÉTECTION AUTOMATIQUE",
      protectionDetail: "Sélectionne un client pour vérifier s’il peut être utilisé directement.",
      isolatedDetected: "CLIENT ISOLÉ DÉTECTÉ",
      isolatedDetail: "Ce client est déjà séparé de Steam. Aucune copie n’est nécessaire.",
      steamDetected: "CLIENT STEAM DÉTECTÉ",
      steamDetail: "Cette installation ne sera pas modifiée. Choisis un emplacement hors de Steam pour la copie ROTK.",
      sourceClient: "CLIENT H1Z1",
      rotkInstall: "INSTALLATION ROTK",
      detectedBadge: "DÉTECTÉ AUTO",
      recommendedBadge: "RECOMMANDÉ",
      subfolderHint: "Un sous-dossier ROTK est créé automatiquement dans l’emplacement choisi — inutile de le créer toi-même.",
      choose: "CHOISIR",
      cancelCopy: "ANNULER",
      createInstall: "CRÉER UNE COPIE SÉPARÉE",
      useExisting: "UTILISER CE CLIENT",
      legal: "Le jeu n’est ni téléchargé ni redistribué par ROTK. La copie provient uniquement de tes fichiers locaux.",
      progressPhases: {
        scanning: "ANALYSE",
        copying: "COPIE",
        verifying: "VÉRIFICATION",
        configuring: "CONFIGURATION",
        finalizing: "FINALISATION",
      },
      progressFiles: {
        scanning: "Analyse du client H1Z1",
        verifying: "Vérification SHA-256",
        configuring: "Application du client ROTK",
        finalizing: "Finalisation atomique",
      },
    },
    activity: {
      regionLabel: "Opérations du launcher",
      eyebrow: "OPÉRATION EN COURS",
      installation: "INSTALLATION DU CLIENT ROTK",
      assets: "ASSETS DU JEU ROTK",
      integrity: "VÉRIFICATION DES FICHIERS",
      launch: "LANCEMENT DU JEU",
      launcherUpdate: "MISE À JOUR DU LAUNCHER",
      checkingUpdate: "RECHERCHE DE MISE À JOUR",
      checkingAssets: "Vérification du flux officiel des assets",
      preparingFiles: "Préparation des fichiers du client H1Z1",
      integrityDetail: "Vérification de chaque fichier avant le lancement",
      launchDetail: "Préparation de la session de jeu sécurisée",
      updateDetail: "Connexion au flux officiel des releases",
      working: "EN COURS",
      files: (completed, total) => `${completed} / ${total} fichiers`,
      packs: (completed, total) => `${completed} / ${total} packs`,
      progress: (operation) => `Progression de l’opération ${operation}`,
    },
    integrity: {
      verifying: "VÉRIFICATION DES FICHIERS DU JEU",
    },
    assets: {
      title: "ASSETS PERSONNALISÉS",
      description: "Les packs d’assets ROTK sont téléchargés depuis le flux officiel, vérifiés en SHA-256 et mis à jour avant chaque lancement.",
      updating: "MISE À JOUR DES ASSETS",
      status: {
        idle: "PAS ENCORE SYNCHRONISÉ",
        disabled: "SYNC DÉSACTIVÉE",
        checking: "VÉRIFICATION",
        downloading: "TÉLÉCHARGEMENT",
        installing: "INSTALLATION",
        "up-to-date": "À JOUR",
        warning: "AVERTISSEMENT",
        error: "ERREUR",
      },
      packVersion: (version) => `Pack d’assets ${version}`,
      neverSynced: "Aucun pack d’assets installé",
      warnings: {
        "feed-unavailable": "Flux d’assets injoignable — le jeu utilise les assets déjà installés.",
        "sync-failed": "Mise à jour des assets échouée — le jeu utilise les assets déjà installés.",
      },
      verify: "VÉRIFIER LES FICHIERS",
      restore: "RESTAURER LE CLIENT VANILLA",
      autoSync: "Mettre à jour les assets personnalisés automatiquement",
    },
  },
};

interface I18nContextValue {
  locale: AppLocale;
  copy: Copy;
  setLocale(locale: AppLocale): void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function storedLocale(): AppLocale {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isAppLocale(value) ? value : "en";
  } catch {
    return "en";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(storedLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // A blocked storage backend should not prevent language selection for
      // the current session.
    }
    void window.rotk.setLocale(locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, copy: COPY[locale], setLocale }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
