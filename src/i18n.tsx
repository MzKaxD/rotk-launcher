import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { isAppLocale, type AppLocale } from "../shared/locale";
import type { PlayerRole } from "../shared/launch-profile";

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
    devTools: string;
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
    settings: string;
    playerIdentity: string;
    addAccountKey: string;
    adminMode: string;
    selectServer: string;
    playersInGame: string;
    playersUnavailable: string;
    playersUnknown: string;
  };
  identity: {
    panelLabel: string;
    eyebrow: string;
    title: string;
    intro: string;
    roles: Record<PlayerRole, string>;
    keyLabels: Record<PlayerRole, string>;
    keyHints: Record<PlayerRole, (websiteHost: string) => string>;
    keySet: string;
    keyMissing: string;
    extraKeys: string;
    extraKeysCount: (configured: number, total: number) => string;
    extraKeysHint: string;
    placeholder: string;
    sessionOnly: string;
    process: (websiteHost: string) => string;
    openAccount: (websiteHost: string) => string;
    invalid: string;
    applied: string;
    removed: string;
    copied: string;
    apply: string;
    remove: string;
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
  devTools: {
    panelLabel: string;
    eyebrow: string;
    title: string;
    intro: string;
    close: string;
    copy: string;
    copied: string;
    copyFailed: string;
    openUserData: string;
    openLogs: string;
    openGameLogs: string;
    openSessions: string;
    captureSession: string;
    capturedSession: string;
    clearLogs: string;
    emptyLogs: string;
    emptyCombat: string;
    emptyKillFeed: string;
    chromium: string;
    reload: string;
    revalidate: string;
    scanCompanion: string;
    scannedCompanion: string;
    exportFile: string;
    exported: string;
    yes: string;
    no: string;
    listening: string;
    idle: string;
    companionNote: string;
    combatNote: string;
    killFeedNote: string;
    ipBanNote: string;
    ipBanWarning: string;
    remoteSessionsNote: string;
    remoteSessionsUnavailable: string;
    remoteSessionsForbidden: string;
    remoteSessionsIdle: string;
    emptyRemoteSessions: string;
    preferTestServer: string;
    live: string;
    emptyDefinitions: string;
    emptyFlags: string;
    emptyConnections: string;
    emptyIpBans: string;
    banIp: string;
    bannedIp: string;
    sections: {
      runtime: string;
      paths: string;
      launch: string;
      identity: string;
      logs: string;
      security: string;
      endpoints: string;
      health: string;
      companion: string;
      combat: string;
      killFeed: string;
      ipBans: string;
      remoteSessions: string;
      definitions: string;
      clientConfig: string;
    };
    fields: {
      version: string;
      electron: string;
      chrome: string;
      node: string;
      isolatedData: string;
      vite: string;
      userData: string;
      appPath: string;
      logsRoot: string;
      installation: string;
      realPath: string;
      source: string;
      destination: string;
      phase: string;
      pid: string;
      running: string;
      canPlay: string;
      updateRequired: string;
      gateway: string;
      attestation: string;
      server: string;
      role: string;
      environment: string;
      website: string;
      assets: string;
      launcherUpdate: string;
      sandbox: string;
      isolation: string;
      encryption: string;
      gatewayOrigin: string;
      voice: string;
      login: string;
      ticketUrl: string;
      challengeUrl: string;
      marker: string;
      buildId: string;
      installedAt: string;
      matchesConfig: string;
      scanStatus: string;
      scannedAt: string;
      processCount: string;
      flagCount: string;
      player: string;
      ip: string;
      seenAt: string;
      banReason: string;
      kills: string;
      deaths: string;
      headshots: string;
      killGap: string;
    };
    attestation: Record<"idle" | "attested" | "not-applicable" | "unavailable", string>;
    companionStatus: Record<"idle" | "ok" | "unavailable", string>;
    companionCategory: Record<"cheat" | "injector" | "debugger", string>;
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
      devTools: "DEV",
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
      settings: "Installation and settings",
      playerIdentity: "ROTK account key",
      addAccountKey: "ADD ROTK KEY",
      adminMode: "ADMIN",
      selectServer: "Choose the ROTK server and launch mode",
      playersInGame: "IN GAME",
      playersUnavailable: "—",
      playersUnknown: "Player count unavailable",
    },
    identity: {
      panelLabel: "ROTK account authentication",
      eyebrow: "ROTK ACCOUNT",
      title: "LAUNCHER KEY",
      intro: "This key links every launch to your ROTK account, Steam identity and persistent game data.",
      roles: {
        player: "PLAYER",
        admin: "ADMIN / MOD",
      },
      keyLabels: {
        player: "PLAYER KEY",
        admin: "ADMIN / MOD KEY",
      },
      keyHints: {
        player: (websiteHost) => `${websiteHost} > Avatar > Account settings > ROTK launcher key.`,
        admin: (websiteHost) => `${websiteHost} > admin area > administrator launcher key. Only granted administrators have one.`,
      },
      keySet: "SAVED",
      keyMissing: "MISSING",
      extraKeys: "OTHER KEYS",
      extraKeysCount: (configured, total) => `${configured}/${total} saved`,
      extraKeysHint: "Each ROTK server has its own accounts, and an administrator key belongs to a different account than your player key. Fill in only what you need.",
      placeholder: "32 hexadecimal characters",
      sessionOnly: "Saved with Windows encryption for this account. It is never generated by the launcher.",
      process: (websiteHost) => `Create or sign in to your account on ${websiteHost}, copy the key below, then save it here.`,
      openAccount: (websiteHost) => `OPEN ${websiteHost.toLocaleUpperCase("en-US")}`,
      invalid: "Enter exactly 32 hexadecimal characters (0-9, a-f).",
      applied: "ROTK account key saved securely.",
      removed: "ROTK account key removed from this computer.",
      copied: "ROTK account key copied.",
      apply: "SAVE KEY",
      remove: "Remove this key",
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
    devTools: {
      panelLabel: "ROTK launcher developer tools",
      eyebrow: "OPERATOR TOOLS",
      title: "DEV TOOLS",
      intro: "Operator diagnostics for this launcher. Player keys, launch tickets and the session gateway URL are never shown.",
      close: "Close developer tools",
      copy: "COPY DIAGNOSTICS",
      copied: "Redacted diagnostics copied.",
      copyFailed: "Could not copy diagnostics.",
      openUserData: "OPEN USER DATA",
      openLogs: "OPEN LAUNCHER LOGS",
      openGameLogs: "OPEN GAME LOGS",
      openSessions: "OPEN SESSIONS",
      captureSession: "CAPTURE SESSION",
      capturedSession: "Session dossier written.",
      clearLogs: "CLEAR LOG",
      emptyLogs: "No launcher events recorded yet.",
      emptyCombat: "No lines in this combat log yet.",
      emptyKillFeed: "No kills in the current KillFeed window.",
      chromium: "CHROMIUM INSPECTOR",
      reload: "RELOAD UI",
      revalidate: "REVALIDATE INSTALL",
      scanCompanion: "SCAN PROCESSES",
      scannedCompanion: "Companion process scan complete.",
      exportFile: "EXPORT JSON",
      exported: "Diagnostics written to user data.",
      yes: "YES",
      no: "NO",
      listening: "LISTENING",
      idle: "IDLE",
      companionNote: "User-mode heuristics only. Absence of flags is not proof of a clean machine. The account service decides what a flag means.",
      combatNote: "Live tails from this installation. Other players' machines are not visible here.",
      killFeedNote: "Parsed from this machine's KillFeed.log. Names only — not a ban list. Tight gaps are highlighted for review.",
      ipBanNote: "Local-zone joins on this PC. Live GAME 2 / TEST IPs come from the account service when this key is a moderator.",
      ipBanWarning: "IP bans can hit everyone behind the same NAT or VPN. Hardware identity already rides with launch tickets; that is the stronger layer for new accounts.",
      remoteSessionsNote: "Polled from the selected server's account service. The server decides who is a moderator. Regular player keys never receive this list.",
      remoteSessionsUnavailable: "Live connecting IPs are not available from the account service yet. They will appear here for moderators once ROTK enables that on this server.",
      remoteSessionsForbidden: "This launcher key is not a moderator on that server.",
      remoteSessionsIdle: "Add a launcher key to request live sessions for this server.",
      emptyRemoteSessions: "No live sessions returned yet.",
      preferTestServer: "This unpackaged launcher is pointed at GAME 2 (production). Use ROTK TEST for iteration when that account key is available.",
      live: "LIVE",
      emptyDefinitions: "No definition loads recorded yet.",
      emptyFlags: "No matching companion tools.",
      emptyConnections: "No local zone connections recorded yet. Start the local zone, then join it.",
      emptyIpBans: "No active local IP bans.",
      banIp: "BAN IP",
      bannedIp: "IP banned for the local zone. New accounts from that address will be refused on next connect.",
      sections: {
        runtime: "RUNTIME",
        paths: "PATHS",
        launch: "LAUNCH",
        identity: "KEY SLOTS",
        logs: "LAUNCHER LOG",
        security: "SECURITY",
        endpoints: "PUBLIC ENDPOINTS",
        health: "INSTALL HEALTH",
        companion: "COMPANION PROCESSES",
        combat: "COMBAT LOGS",
        killFeed: "KILL FEED",
        ipBans: "LOCAL ZONE IPS",
        remoteSessions: "LIVE SERVER SESSIONS",
        definitions: "CLIENT DEFINITIONS",
        clientConfig: "CLIENTCONFIG.INI",
      },
      fields: {
        version: "LAUNCHER",
        electron: "ELECTRON",
        chrome: "CHROME",
        node: "NODE",
        isolatedData: "ISOLATED USER DATA",
        vite: "VITE DEV SERVER",
        userData: "USER DATA",
        appPath: "APP PATH",
        logsRoot: "LOGS",
        installation: "INSTALLATION",
        realPath: "REAL PATH",
        source: "SOURCE",
        destination: "DESTINATION",
        phase: "PHASE",
        pid: "GAME PID",
        running: "H1Z1 RUNNING",
        canPlay: "CAN PLAY",
        updateRequired: "UPDATE REQUIRED",
        gateway: "SESSION GATEWAY",
        attestation: "ATTESTATION",
        server: "SERVER",
        role: "ROLE",
        environment: "ENVIRONMENT",
        website: "WEBSITE",
        assets: "ASSETS",
        launcherUpdate: "LAUNCHER UPDATE",
        sandbox: "SANDBOX",
        isolation: "CONTEXT ISOLATION",
        encryption: "DPAPI AVAILABLE",
        gatewayOrigin: "GAME GATEWAY",
        voice: "VOICE GRANT",
        login: "LOGIN LISTENERS",
        ticketUrl: "TICKET API",
        challengeUrl: "ATTESTATION API",
        marker: "MARKER",
        buildId: "CLIENT BUILD",
        installedAt: "INSTALLED AT",
        matchesConfig: "MARKER MATCHES CONFIG",
        scanStatus: "SCAN",
        scannedAt: "SCANNED AT",
        processCount: "PROCESSES",
        flagCount: "FLAGS",
        player: "PLAYER",
        ip: "IP",
        seenAt: "LAST SEEN",
        banReason: "REASON",
        kills: "KILLS",
        deaths: "DEATHS",
        headshots: "HEADSHOTS",
        killGap: "MIN KILL GAP",
      },
      attestation: {
        idle: "IDLE",
        attested: "ATTESTED",
        "not-applicable": "NOT APPLICABLE",
        unavailable: "UNAVAILABLE",
      },
      companionStatus: {
        idle: "IDLE",
        ok: "OK",
        unavailable: "UNAVAILABLE",
      },
      companionCategory: {
        cheat: "CHEAT",
        injector: "INJECTOR",
        debugger: "DEBUGGER",
      },
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
      devTools: "DEV",
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
      settings: "Installation et réglages",
      playerIdentity: "Clé de compte ROTK",
      addAccountKey: "AJOUTER LA CLÉ ROTK",
      adminMode: "ADMIN",
      selectServer: "Choisir le serveur ROTK et le mode de lancement",
      playersInGame: "EN JEU",
      playersUnavailable: "—",
      playersUnknown: "Nombre de joueurs indisponible",
    },
    identity: {
      panelLabel: "Authentification du compte ROTK",
      eyebrow: "COMPTE ROTK",
      title: "CLÉ LAUNCHER",
      intro: "Cette clé relie chaque lancement à ton compte ROTK, ton identité Steam et tes données de jeu persistantes.",
      roles: {
        player: "JOUEUR",
        admin: "ADMIN / MOD",
      },
      keyLabels: {
        player: "CLÉ JOUEUR",
        admin: "CLÉ ADMIN / MOD",
      },
      keyHints: {
        player: (websiteHost) => `${websiteHost} > Avatar > Account settings > ROTK launcher key.`,
        admin: (websiteHost) => `${websiteHost} > espace admin > clé launcher administrateur. Réservée aux administrateurs autorisés.`,
      },
      keySet: "ENREGISTRÉE",
      keyMissing: "ABSENTE",
      extraKeys: "AUTRES CLÉS",
      extraKeysCount: (configured, total) => `${configured}/${total} enregistrées`,
      extraKeysHint: "Chaque serveur ROTK a ses propres comptes, et une clé administrateur appartient à un compte différent de ta clé joueur. Ne remplis que ce dont tu as besoin.",
      placeholder: "32 caractères hexadécimaux",
      sessionOnly: "Enregistrée avec le chiffrement Windows de ce compte. Le launcher ne la génère jamais.",
      process: (websiteHost) => `Crée ou connecte ton compte sur ${websiteHost}, copie la clé, puis enregistre-la ici.`,
      openAccount: (websiteHost) => `OUVRIR ${websiteHost.toLocaleUpperCase("en-US")}`,
      invalid: "Saisis exactement 32 caractères hexadécimaux (0-9, a-f).",
      applied: "Clé de compte ROTK enregistrée de façon sécurisée.",
      removed: "Clé de compte ROTK supprimée de cet ordinateur.",
      copied: "Clé de compte ROTK copiée.",
      apply: "ENREGISTRER LA CLÉ",
      remove: "Supprimer cette clé",
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
    devTools: {
      panelLabel: "Outils développeur du launcher ROTK",
      eyebrow: "OUTILS OPÉRATEUR",
      title: "DEV TOOLS",
      intro: "Diagnostics opérateur de ce launcher. Les clés joueur, tickets de lancement et l’URL de la passerelle de session ne sont jamais affichés.",
      close: "Fermer les outils développeur",
      copy: "COPIER LES DIAGNOSTICS",
      copied: "Diagnostics expurgés copiés.",
      copyFailed: "Impossible de copier les diagnostics.",
      openUserData: "OUVRIR USER DATA",
      openLogs: "JOURNAUX LAUNCHER",
      openGameLogs: "JOURNAUX DU JEU",
      openSessions: "SESSIONS",
      captureSession: "CAPTURER LA SESSION",
      capturedSession: "Dossier de session écrit.",
      clearLogs: "VIDER LE JOURNAL",
      emptyLogs: "Aucun événement launcher pour l’instant.",
      emptyCombat: "Aucune ligne dans ce journal de combat.",
      emptyKillFeed: "Aucun kill dans la fenêtre KillFeed actuelle.",
      chromium: "INSPECTEUR CHROMIUM",
      reload: "RECHARGER L’UI",
      revalidate: "REVÉRIFIER L’INSTALL",
      scanCompanion: "SCANNER LES PROCESSUS",
      scannedCompanion: "Scan des processus compagnons terminé.",
      exportFile: "EXPORTER JSON",
      exported: "Diagnostics écrits dans les données utilisateur.",
      yes: "OUI",
      no: "NON",
      listening: "À L’ÉCOUTE",
      idle: "INACTIVE",
      companionNote: "Heuristiques en mode utilisateur uniquement. L’absence de signal n’est pas une preuve de machine propre. Le service de comptes décide de la suite.",
      combatNote: "Extraits en direct de cette installation. Les machines des autres joueurs ne sont pas visibles ici.",
      killFeedNote: "Lu depuis le KillFeed.log de cette machine. Noms uniquement — pas une liste de bannissement. Les intervalles serrés sont marqués pour relecture.",
      ipBanNote: "Connexions de la zone locale sur ce PC. Les IP GAME 2 / TEST viennent du service de comptes lorsque cette clé est modérateur.",
      ipBanWarning: "Un ban IP peut toucher tout le monde derrière le même NAT ou VPN. L’identité matérielle voyage déjà avec les tickets de lancement ; c’est la couche la plus solide contre les nouveaux comptes.",
      remoteSessionsNote: "Interrogé auprès du service de comptes du serveur choisi. C’est le serveur qui décide qui est modérateur. Une clé joueur ordinaire ne reçoit pas cette liste.",
      remoteSessionsUnavailable: "Les IP de connexion en direct ne sont pas encore fournies par le service de comptes. Elles apparaîtront ici pour les modérateurs une fois que ROTK les activera sur ce serveur.",
      remoteSessionsForbidden: "Cette clé launcher n’est pas modérateur sur ce serveur.",
      remoteSessionsIdle: "Ajoute une clé launcher pour demander les sessions en direct de ce serveur.",
      emptyRemoteSessions: "Aucune session en direct pour l’instant.",
      preferTestServer: "Ce launcher non empaqueté pointe vers GAME 2 (production). Utilise ROTK TEST pour itérer dès que la clé de ce compte est disponible.",
      live: "EN DIRECT",
      emptyDefinitions: "Aucun chargement de définitions pour l’instant.",
      emptyFlags: "Aucun outil compagnon correspondant.",
      emptyConnections: "Aucune connexion de zone locale enregistrée. Démarre la zone locale, puis rejoins-la.",
      emptyIpBans: "Aucun ban IP local actif.",
      banIp: "BAN IP",
      bannedIp: "IP bannie pour la zone locale. Les nouveaux comptes depuis cette adresse seront refusés à la prochaine connexion.",
      sections: {
        runtime: "RUNTIME",
        paths: "CHEMINS",
        launch: "LANCEMENT",
        identity: "EMPLACEMENTS DE CLÉS",
        logs: "JOURNAL LAUNCHER",
        security: "SÉCURITÉ",
        endpoints: "POINTS D’ACCÈS PUBLICS",
        health: "SANTÉ DE L’INSTALL",
        companion: "PROCESSUS COMPAGNONS",
        combat: "JOURNAUX DE COMBAT",
        killFeed: "KILL FEED",
        ipBans: "IPS ZONE LOCALE",
        remoteSessions: "SESSIONS SERVEUR",
        definitions: "DÉFINITIONS CLIENT",
        clientConfig: "CLIENTCONFIG.INI",
      },
      fields: {
        version: "LAUNCHER",
        electron: "ELECTRON",
        chrome: "CHROME",
        node: "NODE",
        isolatedData: "DONNÉES ISOLÉES",
        vite: "SERVEUR VITE",
        userData: "USER DATA",
        appPath: "CHEMIN APP",
        logsRoot: "JOURNAUX",
        installation: "INSTALLATION",
        realPath: "CHEMIN RÉEL",
        source: "SOURCE",
        destination: "DESTINATION",
        phase: "PHASE",
        pid: "PID DU JEU",
        running: "H1Z1 EN COURS",
        canPlay: "PRÊT À JOUER",
        updateRequired: "MAJ OBLIGATOIRE",
        gateway: "PASSERELLE DE SESSION",
        attestation: "ATTESTATION",
        server: "SERVEUR",
        role: "RÔLE",
        environment: "ENVIRONNEMENT",
        website: "SITE",
        assets: "ASSETS",
        launcherUpdate: "MAJ LAUNCHER",
        sandbox: "SANDBOX",
        isolation: "ISOLATION DE CONTEXTE",
        encryption: "DPAPI DISPONIBLE",
        gatewayOrigin: "GATEWAY JEU",
        voice: "GRANT VOCAL",
        login: "LISTENERS LOGIN",
        ticketUrl: "API TICKET",
        challengeUrl: "API ATTESTATION",
        marker: "MARQUEUR",
        buildId: "BUILD CLIENT",
        installedAt: "INSTALLÉ LE",
        matchesConfig: "MARQUEUR = CONFIG",
        scanStatus: "SCAN",
        scannedAt: "SCANNÉ À",
        processCount: "PROCESSUS",
        flagCount: "SIGNAUX",
        player: "JOUEUR",
        ip: "IP",
        seenAt: "VU LE",
        banReason: "MOTIF",
        kills: "KILLS",
        deaths: "MORTS",
        headshots: "HEADSHOTS",
        killGap: "ÉCART MIN. KILLS",
      },
      attestation: {
        idle: "INACTIVE",
        attested: "ATTESTÉE",
        "not-applicable": "SANS OBJET",
        unavailable: "INDISPONIBLE",
      },
      companionStatus: {
        idle: "INACTIF",
        ok: "OK",
        unavailable: "INDISPONIBLE",
      },
      companionCategory: {
        cheat: "TRICHE",
        injector: "INJECTEUR",
        debugger: "DÉBOGUEUR",
      },
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
