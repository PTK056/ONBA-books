# Contexte de départ (07/10/2026)

Repris de la session Casa ONBA où le projet a été lancé.

## L'idée
Rendre commercialisable le « Casa ONBA Control Room », le dashboard finance et
opérations de la villa de Pierre à Bali, pour d'autres propriétaires Airbnb et
gestionnaires (Bali d'abord, puis l'Australie et ailleurs).

## L'existant (Casa ONBA, client n°0), à ne jamais toucher depuis ce dossier
- Front-end : un artifact claude.ai qui lit et écrit dans Airtable via le connecteur MCP de Pierre.
- Back-end : Airtable, plan gratuit (quota d'environ 1 000 appels API par mois).
- Moteur des tickets : Python sur le Mac de Pierre (launchd) ; photos → lecture Claude → lots à valider.
- Onglets : Overview, Months, Costs, Evidence, Stays (import CSV Airbnb), Reimbursements,
  Team (paie), Bank (rapprochement des relevés Danamon PDF), Add a receipt,
  synthèse PDF mensuelle, « Ask about the numbers ».
- Les éléments propres à Casa ONBA : IDR, banque Danamon, PT PMA, personnel (Kadek, Alit), avances de Pierre (`-OA`).

## Décisions prises
- **Nom : ONBA Books.** Domaines libres le 07/10 : onbabooks.com, onba.io, onba.co (pas encore réservés).
  Marque : aucun « ONBA » en Indonésie, en Australie ni dans l'UE (TMView, OMPI, PDKI) ; dépôt reporté.
- **Cible : propriétaires ET gestionnaires.** Modèle de données : Organisation → Villas → Propriétaires
  (un propriétaire seul = une organisation à une villa ; le gestionnaire donne à chaque propriétaire un accès en lecture).
- **Un seul code, configurable.** Le sur-mesure passe par des réglages et des modules activables, jamais par une copie du code. Pas de version à télécharger : un service hébergé en abonnement.
- ~~Back-end en deux temps : pilote sur Airtable puis SaaS sur Supabase.~~ Remplacé le 08/10 (voir `cadrage.md` §4) :
  **Supabase direct dès le pilote** (Postgres + Row Level Security), web app Next.js/Vercel, Stripe, moteur de tickets dans le cloud.
- **Produit en libre-service** : le client utilise l'outil lui-même ; Pierre vend et maintient le système, il ne tient la compta de personne.

## Risques notés
- ONBA est aussi une société de gestion locative : un frein possible pour vendre aux gestionnaires concurrents.
- Facturation : les codes d'activité (KBLI) de PT ONBA ne couvrent probablement pas le logiciel.
- Données personnelles : RGPD, UU PDP (Indonésie), Privacy Act (Australie).

## État au 20/10/2026
Cadrage fait (`docs/cadrage.md`). Décisions depuis : **Supabase direct** (pas de phase Airtable),
**produit en libre-service** (Pierre vend le système, ne tient la compta de personne),
segment à trancher après 5–10 entretiens (base déjà prévue pour les gestionnaires).

Code dans `app/` (Next.js 16 + Supabase), branche **`core-schema`**, pas encore fusionnée dans `main`.
Projet Supabase `wnmukybwihyrxzcbfbdz` lié (CLI connectée sur le Mac de Pierre) ; migrations et
Edge Function `read-receipts` déployées. L'app tourne en local (`npm run dev` dans `app/`) ;
Casa ONBA y est la première organisation réelle (tickets de démo + 44 séjours Airbnb importés).

Ce qui marche de bout en bout :
- **Tickets** : Scan receipts → lecture Claude (Opus 5.5) → Review (champs douteux surlignés) → écriture validée + justificatif.
- **Saisie à la main** (dépense / recette), justificatif joint tout de suite ou plus tard.
- **Import Airbnb** (Transaction history CSV) : séjours, revenus et frais répartis par nuits, taux de chaque versement
  (net = versé par Airbnb au rupiah près). Réimport idempotent.
- **Overview** : vues Month / Year / All time, occupation, prix par nuit, clôture du mois.
- **Transactions** (journal, recherche, fiche avec Download / Share / WhatsApp / lien 7 jours) et
  **Documents** (dossiers année → mois, filtres par catégorie, ZIP).
- **Relevé mensuel PDF** par villa.

Vérifications : `npm test` (parser Airbnb), `npm run test:db` (SQL sur PGlite), `npm run check:queries`
(requêtes de l'app rejouées contre le projet), `npx tsc --noEmit`, `npx eslint`, `npx next build`.
Pages de démo sans connexion (dev seulement) : `/dev/overview`, `/dev/period`, `/dev/review`, `/dev/import`, `/dev/statement`.

Secrets hors dépôt : clé Anthropic dans `~/.config/onbabooks/anthropic_key` (aussi en secret de la
fonction Supabase) ; `app/.env.local` (URL + clé publique Supabase).

## Prochaines étapes (ordre proposé)
1. **Mise en ligne** (Vercel) + vrai service d'e-mails pour la connexion (l'envoi Supabase par défaut est
   limité aux membres de l'équipe et à quelques e-mails/heure). Débloque l'usage sur téléphone.
2. Rapprochement bancaire Danamon (Claude lit bien les relevés PDF).
3. Couche gestionnaire : frais de gestion, relevés propriétaires à la marque, accès propriétaires.
4. Entretiens prospects (questions dans `docs/cadrage.md` §6).
