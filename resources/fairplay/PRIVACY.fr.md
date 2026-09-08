# FairPlay — informations pour les joueurs

FairPlay accompagne uniquement votre session ROTK et se ferme avec le jeu. Il fonctionne avec vos droits habituels, sans pilote, sans service permanent et sans démarrage automatique avec Windows.

Pendant la session, il observe les DLL chargées dans le jeu (nom du fichier, empreinte SHA-256, état de signature) ainsi que des compteurs de zones de mémoire exécutables privées. Il transmet ces observations au service ROTK pour aider les administrateurs habilités à examiner des anomalies. Il ne lit ni ne transmet le contenu de la mémoire, les documents, l'historique de navigation, les mots de passe, les noms de comptes Windows ou les lignes de commande.

Deux vérifications facultatives nécessitent votre accord dans le launcher, puis une confirmation visible pour chaque demande :

- **Programmes ouverts** : uniquement le nom de chaque fichier exécutable et son numéro de processus, sans chemin ni titre de fenêtre. Les noms peuvent révéler les logiciels que vous utilisez.
- **Capture du jeu** : uniquement la zone intérieure de la fenêtre ROTK au premier plan. Le chat et les informations visibles dans le jeu peuvent figurer dans cette image. Le bureau et les autres fenêtres ne sont jamais capturés. Si cette capture limitée échoue, FairPlay signale un échec.

Vous pouvez refuser ces demandes. Sans réponse, la confirmation est refusée après environ vingt secondes. Les options facultatives sont désactivées par défaut. FairPlay n'offre aucune commande de prise en main du PC, d'ouverture de fichier, d'exécution de programme ou d'envoi d'un exécutable à un administrateur.

Une observation anormale indique un élément à examiner : elle ne prouve pas à elle seule une triche. Des composants légitimes du jeu ou des overlays peuvent produire des observations similaires. La décision de sanction doit être examinée par un administrateur habilité.

Les données sont envoyées via HTTPS au service ROTK configuré par le launcher. Les détails de conservation, d'accès et de contact doivent être communiqués par l'exploitant dans la politique de confidentialité ROTK avant activation publique.
