# Prépa Commandes — prototype

Prototype Next.js + Neon PostgreSQL pour remplacer le bon papier de préparation par une interface web téléphone/PC.

## Ce qui est déjà inclus

- Tableau de bord des commandes.
- Import d'un bon de production PDF.
- Extraction du numéro de commande, client, référence interne, date d'enlèvement et lignes.
- Lecture de la quantité depuis la colonne de quantité du PDF grâce aux coordonnées du document.
- Affichage de l'emplacement quand il est détecté.
- Bouton **Tout préparé** : pas besoin de taper la quantité quand la ligne est complète.
- Saisie uniquement pour une quantité partielle.
- Pause / reprise d'une commande.
- Plusieurs commandes peuvent donc être laissées en cours et reprises plus tard.
- Progression calculée automatiquement.
- Les lignes clairement informatives (`INFO...`, `EN ATTENTE DE COTE`, `GTRANS`) sont exclues du calcul de progression mais restent visibles.
- Le PDF n'est pas enregistré : il est analysé à l'import puis seules les données utiles sont stockées.
- Base PostgreSQL Neon avec création automatique des tables au premier accès.

## Déploiement Vercel

### 1. Neon
Créer un projet PostgreSQL sur Neon et récupérer sa chaîne `DATABASE_URL`.

### 2. GitHub
Téléverser **le contenu de ce dossier** dans un nouveau dépôt GitHub.

### 3. Vercel
Importer le dépôt dans Vercel.

Dans `Settings > Environment Variables`, ajouter :

`DATABASE_URL` = ta chaîne Neon.

Puis redéployer.

### 4. Tester
Ouvrir `/admin`, déposer le bon PDF et créer la commande.

## Important

C'est un **prototype fonctionnel**, pas encore une version de production. Il n'y a volontairement pas d'authentification ni de gestion des droits : toute personne ayant l'URL peut utiliser l'application.

Le parseur est adapté au format du bon de production fourni pour le prototype. Avant utilisation réelle, il faudra prévoir une étape de validation du parsing et tester plusieurs types de bons.

La base ne reçoit pas une requête à chaque clic de navigation : seules les actions de préparation/pause et le chargement des commandes écrivent/lisent les données nécessaires.
