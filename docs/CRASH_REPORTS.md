# Rapports de crash — launcher ROTK 2.0.7

Cette fonctionnalité est préparée pour **2.0.7**. Cette documentation accompagne
une version de travail **non publiée** : elle ne signifie pas que la mise à jour
est déjà disponible pour les joueurs. Avant publication, le serveur doit admettre
la version **2.0.7** et les binaires correspondants dans les contrôles de version
et d’attestation applicables. Valider le paquet exact sur TEST, puis coordonner
son admission et sa publication. Une simple modification de `package.json` ne
met pas à jour cette politique serveur.

## Joueur : après un crash

Ouvre le launcher et clique sur **J’ai crashé**, en bas de la fenêtre. Le launcher
rassemble les diagnostics disponibles et prépare le ZIP. Si la collecte ou
l’archive prend du temps, un message indique que la préparation est en cours.

Quand le fichier est prêt, **l’Explorateur Windows s’ouvre avec le ZIP sélectionné**.
Envoie ce fichier à l’administrateur par le canal privé convenu. C’est la seule
action à effectuer dans le launcher : aucun formulaire ou choix de fichier n’est
nécessaire.

Le ZIP est enregistré automatiquement dans **Téléchargements → ROTK-Rapports**,
dans le dossier Téléchargements configuré sur ce PC. Son nom suit la forme
`ROTK-crash-DATE-ID8-unique.zip` : la date, un identifiant abrégé et un suffixe
unique distinguent les exports. Tu peux y retrouver le fichier plus tard.

Le launcher **n’envoie aucun rapport automatiquement**. Il crée un fichier local
contenant les journaux, les informations de session et les dumps disponibles.
Les dumps peuvent contenir des données de session : partage le ZIP uniquement
avec un administrateur de confiance. Si une erreur empêche la création du ZIP,
le launcher l’indique ; il ne faut pas considérer un fichier temporaire comme un
rapport terminé.

Lors de l’envoi à l’administrateur, tu peux ajouter l’heure approximative et
l’action effectuée : par exemple « Combat Training, changement d’arme à 21 h 34
heure de Paris, retour au bureau ». Ces précisions aident à retrouver l’incident.
Un rapport sans dump reste utile ; il ne faut pas recréer artificiellement un
crash pour obtenir un fichier.

## Ce que contient le ZIP

La présence de chaque pièce dépend de ce qui était disponible pour la session.
`manifest.json` décrit le contenu réellement exporté.

| Fichier | Utilité |
| --- | --- |
| `README.txt` | Résumé lisible : identifiant du rapport, début UTC, décalage horaire, version, serveur, joueur, classification et code de sortie. |
| `NOTES.txt` | Mention de la déclaration de crash par le joueur. Elle ne remplace pas les preuves d’une exception native. |
| `report.json` | Schéma version 1 : `summary`, `context`, `timezoneOffsetMinutes`, `exit`, `issues`. |
| `manifest.json` | Identifiant et date d’export, fichiers avec taille et SHA-256, limites, problèmes de collecte et omissions, indicateur `containsUnredactedProcessMemory`. Le manifeste ne contient pas sa propre empreinte. |
| `events.jsonl` | Chronologie du launcher pour cette session : démarrage du jeu, sortie, demande de capture, portions de stdout/stderr, erreurs du launcher enregistrées. |
| `native-events.jsonl` et éventuellement `.1` | Attachement du helper, exceptions, compteurs, modules et versions, mesures mémoire/CPU, captures réussies ou échouées et sortie native. `.1` est le journal précédent. |
| `client-local-….log`, `client-failure-….log`, `client-native-….log` et extensions similaires | Extraits des journaux autorisés du jeu, associés à cette session. Le suffixe évite d’exposer le chemin original. |
| `dumps/crash-….dmp` | Minidump d’une exception fatale observée, si la capture a réussi. Les dumps disponibles sont inclus dans le ZIP créé par le bouton. |
| `dumps/snapshot-….dmp`, éventuellement `-full.dmp` | Capture de l’état du processus lorsqu’elle est disponible. Le suffixe `full` identifie une capture mémoire complète issue du mécanisme technique décrit plus bas. |

Dans `report.json`, consulter notamment :

- `summary.id`, `startedAt`, `endedAt`, `launcherVersion`, `serverLabel`,
  `playerName`, `kind`, `status`, `exitCodeHex`, `captureStatus`, `warnings` ;
- `context.pid`, `processStartedAt`, `processEndedAt`, `steamId`, `serverId`,
  `role`, `assetPackVersion`, lorsqu’ils sont disponibles ;
- `context.playerReportedCrash` et `playerReportedAt` : déclaration du joueur et
  heure UTC du clic. La classification et le code de sortie observés sont conservés ;
- `context.binaries` : taille, SHA-256 et date de modification des exécutables et
  DLL ciblés ; une entrée `unavailable` n’est pas une preuve de modification ;
- `context.systemInfo` et éventuellement `systemInfoAtCapture` : Windows, CPU,
  RAM, carte graphique et pilote lorsque l’interrogation Windows a réussi ;
- `context.windowsEvents` : événements Windows Application Error, Hang et WER
  retrouvés dans la fenêtre de la session ;
- `exit.code`, `unsignedCode`, `hex`, `name`, `signal`, `error` et `issues` pour
  distinguer une exception, un échec de lancement et une information absente.

Les journaux client sont bornés et sélectionnés ; il ne s’agit pas de tous les
fichiers du PC. Les portions antérieures au lancement sont normalement exclues.
Après la sortie, les limites et empreintes des sources sont figées pour éviter
qu’un export ultérieur mélange les journaux d’une nouvelle partie. Une rotation,
une réécriture ou une source devenue inaccessible est signalée dans `issues`.

## Administrateur : premier tri et corrélation serveur

Commencer par `README.txt`, `NOTES.txt`, puis `report.json`. Noter l’identifiant du
rapport, la version du launcher, le serveur, le joueur ou SteamID disponible, le
PID et les heures de début/fin. Les dates terminées par `Z` sont en **UTC**.
`timezoneOffsetMinutes` est le décalage local vers l’est : `120` signifie UTC+2.
Le PID seul ne suffit pas à corréler deux événements : Windows peut le réutiliser.

Rechercher la session correspondante dans les journaux du bon serveur, autour de
l’heure de sortie et de la dernière action décrite. Comparer les événements de
connexion/déconnexion et les journaux de mode de jeu. Un délai réseau ou un joueur
qui ne répond plus ne prouve pas un crash natif. Si un événement Windows porte
`correlation: "executable-and-time-only"`, il correspond au nom et à la fenêtre
horaire ; cette association est moins précise que `"pid-and-time"`.

Dans le journal natif, rechercher `exception` avec **`firstChance: false`** et le
`dump-written` de **`kind: "fatal"`** associé. Une exception `firstChance: true`
peut être traitée normalement par le jeu. Les trois premières notifications de
chaque code sont détaillées, puis les compteurs limitent le volume. Une capture
`kind: "snapshot"` décrit un état à examiner, pas une preuve d’exception fatale.

| Code Windows | Ce qu’il établit | Ce qu’il ne permet pas de conclure seul |
| --- | --- | --- |
| `0xC0000005` | Violation d’accès mémoire. Les paramètres d’exception peuvent préciser lecture, écriture ou exécution et l’adresse concernée. | La DLL ou la modification à corriger ; il faut le contexte, la pile, les versions et les étapes de reproduction. |
| `0xC00000FD` | Débordement de pile. | La fonction qui a provoqué l’épuisement ou sa cause exacte ; examiner les piles et les répétitions d’appels. |
| Code absent ou sortie non nulle différente | La sortie ou l’observation n’a pas fourni une exception reconnue. | Qu’un crash natif a nécessairement eu lieu, ou qu’aucun problème n’existe. |

Comparer les empreintes de `context.binaries` aux binaires de référence réellement
distribués. Pour regrouper plusieurs incidents, utiliser le code d’exception,
le module, son empreinte/version et l’**offset dans le module**, pas seulement une
adresse absolue : l’ASLR peut changer les bases entre deux lancements. Le module
au sommet de la pile est une piste d’analyse ; il ne désigne pas automatiquement
le composant responsable de la corruption.

Les échantillons `sample` permettent de voir la mémoire privée et résidente du
jeu, la disponibilité physique/engagée du système et le CPU toutes les cinq
secondes. Ils peuvent appuyer une hypothèse de pression mémoire ou de blocage,
sans remplacer l’analyse des piles et du code.

## Administrateur : ouvrir le dump avec WinDbg

Extraire le ZIP dans un dossier privé, puis ouvrir le `.dmp` avec **WinDbg → File
→ Open Crash Dump**, ou lancer `windbg -z "C:\Rapports\crash.dmp"`. Le fichier
est un minidump Windows avec signature `MDMP`. Il faut les binaires et, lorsque
disponibles, les symboles/PDB correspondant exactement à la version capturée.
[Guide Microsoft pour les dumps de processus](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/analyzing-a-user-mode-dump-file).

Exemple de préparation des symboles, avec des chemins à adapter :

```text
.symfix C:\ROTK-Symbols\Microsoft
.sympath+ C:\ROTK-Symbols\Private\2.0.7
.reload /f
lm
```

Le serveur de symboles Microsoft sert les symboles Windows ; il ne fournit pas
les symboles privés de ROTK. Cette récupération éventuelle est une action de
l’administrateur dans WinDbg, distincte du launcher. Sans PDB correspondant, un
module et son offset restent exploitables, mais une ligne de code ou un nom de
fonction privé peut rester inconnu.
[Commandes et symboles WinDbg](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/getting-started-with-windbg).

Pour un **dump fatal** contenant un flux d’exception :

```text
.exr -1
.ecxr
k
!analyze -v
~* k
```

`.exr -1` affiche l’exception, `.ecxr` sélectionne son contexte de registres,
`k` montre la pile du thread sélectionné et `~* k` les piles des threads. Conserver
le code, l’adresse, le module, l’offset, les piles et les avertissements sur les
symboles. L’analyse automatique est une aide à l’enquête.
[Contexte d’exception Microsoft](https://learn.microsoft.com/en-us/shows/inside/ecxr).

Pour un **snapshot de blocage**, commencer par `~* k` et `lm`. Il peut ne pas
exister de flux d’exception : l’échec de `.ecxr` dans ce cas ne signifie pas que le
snapshot est inutilisable. Plusieurs snapshots pris à des moments différents
peuvent aider à distinguer une attente stable d’un traitement lent.

## Développeur : capture native et mémoire complète

La capture automatique utilise un **minidump**, jamais un dump complet. La
collecte des exceptions, registres, modules et mesures mémoire/CPU reste active
dans le mécanisme de diagnostic. Le parcours joueur est limité au bouton
**J’ai crashé** ; il ne propose ni réglages de capture ni sélection de dump complet.

Le backend et le helper conservent une commande de **dump mémoire complet** pour
une intervention technique explicite. Elle peut être utile pour examiner un
blocage ou une corruption, mais peut peser plusieurs Go, prendre plus longtemps
et perturber ou suspendre le processus pendant la collecte. Le helper vérifie que
l’espace disponible couvre la mémoire engagée du processus plus 512 Mio. Après
la fermeture du processus, sa mémoire complète ne peut plus être récupérée.
La commande et ses contraintes sont décrites dans le contrat natif lié en fin
de document. Il ne s’agit pas d’un bouton supplémentaire à demander au joueur.

## Confidentialité, volume et limites

Les textes exportés passent par des règles de masquage des secrets connus,
jetons, mots de passe, adresses et chemins sensibles reconnus. Les fichiers de
configuration/identifiants, l’environnement et la ligne de commande brute sont
exclus. Le joueur/SteamID, les codes, horaires et empreintes utiles à l’enquête
peuvent rester présents. Ce masquage n’est pas une garantie d’anonymisation de
toute chaîne arbitraire écrite par le jeu : relire le contexte avant partage.

**Les dumps binaires ne sont pas masqués.** Un minidump comme un dump complet
peut contenir des données de session, identifiants, messages ou autres morceaux
de mémoire du jeu. Les partager uniquement avec un administrateur de confiance,
par un canal privé. Le ZIP créé par **J’ai crashé** inclut les dumps disponibles,
y compris un dump complet déjà présent. Aucun rapport n’est transmis
automatiquement. Le dossier interne du launcher peut aussi contenir des
métadonnées de travail et des chemins locaux ; utiliser le ZIP préparé pour le
partage au support.

La collecte textuelle vise au maximum **2 Mio par fichier, 20 Mio au total et
40 fichiers de journaux collectés** ; les fichiers de synthèse du ZIP s’y
ajoutent. Les omissions et troncatures sont décrites dans le manifeste. Le helper
fait tourner son journal natif autour de 4 Mio avec une sauvegarde ; l’export peut
donc n’en conserver que les extraits bornés. Les dumps ont leurs propres limites
et ne sont pas réduits au budget des textes.

Le minidump vise un budget de 256 Mio ; si la collecte enrichie échoue, le helper
réessaie une fois avec moins de mémoire indirecte. Ce contrôle utilise les
callbacks Windows et n’est pas un plafond strict. Le launcher applique un
watchdog d’environ 70 secondes pour un dump standard et 200 secondes pour un
complet ; une demande manuelle expire au plus tard autour de 75/205 secondes.
Par processus, le helper limite les captures réussies à dix snapshots manuels,
dont deux complets au maximum, et deux dumps fatals.

Le nettoyage local vise **10 rapports récents, 7 jours et 5 Gio**. Les sessions en
cours/en collecte, le rapport protégé par l’opération et le dernier rapport
terminé sont conservés. Ce sont des objectifs de rétention, **pas un quota disque
strict** : un dump complet protégé peut dépasser 5 Gio. Exporter les rapports
importants avec **J’ai crashé** avant le nettoyage. Les ZIP créés dans
**Téléchargements → ROTK-Rapports** ne font pas partie de cette rétention locale.

Le helper suit uniquement le `H1Z1.exe` lancé par ce launcher. Il n’élève pas les
privilèges, ne modifie pas de DLL de gameplay et désactive le comportement Windows
qui tuerait le jeu à la fermeture du débogueur. Une capture indisponible ne doit
pas empêcher de jouer. Le mode débogage peut toutefois modifier le timing ou
interagir avec d’autres outils ; vérifier son état dans les métadonnées du rapport.

Aucun dump automatique n’est garanti si le problème survient avant l’attachement,
si le jeu est terminé avec `TerminateProcess`, si le launcher/helper est tué,
en cas de panne ou redémarrage du PC, de droits incompatibles, de disque plein ou
d’un autre débogueur déjà attaché. Un arrêt GPU/noyau peut nécessiter des preuves
différentes. Une session récupérée après interruption est signalée comme telle ;
cela ne prouve pas un crash du jeu. Les captures comportent des limites de temps
et un watchdog ; un dump incomplet `.partial` n’est pas présenté comme un `.dmp`
terminé. Aucune capture ne peut reconstituer la mémoire d’un processus disparu.

Le contrat natif et les tests reproductibles sont décrits dans
[`native/diagnostics/README.md`](../native/diagnostics/README.md).
