# Politique de sécurité

## Versions prises en charge

La branche `main` et la dernière version publiée reçoivent les correctifs de sécurité. Les anciennes versions peuvent ne plus être corrigées ; reproduisez toujours un problème sur la version la plus récente avant de le signaler.

## Signaler une vulnérabilité

N’ouvrez pas d’issue publique pour une vulnérabilité non corrigée. Utilisez le signalement privé GitHub du dépôt : **Security → Advisories → Report a vulnerability**.

Le rapport doit contenir, si possible :

- la version du launcher et de Windows ;
- l’impact concret ;
- les étapes minimales de reproduction ;
- les chemins ou entrées nécessaires, anonymisés ;
- une proposition de correction si vous en avez une.

Ne joignez jamais une installation H1Z1, un exécutable propriétaire, une clé privée ou des données personnelles. Un mainteneur répondra dès que possible, confirmera le périmètre et coordonnera la publication du correctif. Merci de laisser un délai raisonnable avant toute divulgation publique.

## Périmètre prioritaire

Nous souhaitons notamment recevoir les signalements concernant :

- un contournement des chemins interdits ou de l’isolation avec Steam ;
- une traversée de répertoires, jonction ou lien symbolique dangereux ;
- une écriture ou suppression en dehors du dossier choisi ;
- l’exécution d’une commande ou d’un binaire arbitraire ;
- une élévation via IPC Electron, preload ou navigation web ;
- l’acceptation d’une actualité, image ou URL depuis une origine non autorisée ;
- une altération non détectée du shim ou d’un payload de release ;
- l’exposition d’un secret, identifiant ou chemin sensible dans les logs.

Les bugs de gameplay du serveur, les problèmes du client H1Z1 d’origine et les clients modifiés hors du flux officiel ROTK ne relèvent pas de cette politique, sauf s’ils créent directement une vulnérabilité dans le launcher.

## Modèle de confiance

Le launcher ne distribue pas H1Z1. Il copie une installation choisie par l’utilisateur vers un emplacement séparé, sauvegarde les fichiers qu’il remplace et ne lance que `H1Z1.exe` depuis cette copie marquée. Le shim embarqué est sous GPL et sa compilation est vérifiée dans la CI Windows.

Les builds de développement ne sont pas nécessairement signés. Vérifiez toujours la provenance d’un exécutable et le SHA-256 publié avec une release officielle.
