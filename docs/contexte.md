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
- **Nom : Splyce** (26/10/2026, domaine `splyce.me` acheté chez GoDaddy pour 3 ans ; le produit s'appelait ONBA Books
  jusque-là, nom écarté car ONBA est aussi une société de gestion locative). **Recherche de marque « Splyce » à faire**
  (TMView, PDKI, IP Australia) : « Splice » (sons pour musiciens) et l'ex-équipe e-sport « Splyce » existent.
- **Cible : propriétaires ET gestionnaires.** Modèle de données : Organisation → Villas → Propriétaires
  (un propriétaire seul = une organisation à une villa ; le gestionnaire donne à chaque propriétaire un accès en lecture).
- **Un seul code, configurable.** Le sur-mesure passe par des réglages et des modules activables, jamais par une copie du code. Pas de version à télécharger : un service hébergé en abonnement.
- ~~Back-end en deux temps : pilote sur Airtable puis SaaS sur Supabase.~~ Remplacé le 08/10 (voir `cadrage.md` §4) :
  **Supabase direct dès le pilote** (Postgres + Row Level Security), web app Next.js/Vercel, Stripe, moteur de tickets dans le cloud.
- **Produit en libre-service** : le client utilise l'outil lui-même ; Pierre vend et maintient le système, il ne tient la compta de personne.

## Risques notés
- ~~ONBA est aussi une société de gestion locative~~ : levé par le passage au nom Splyce (26/10/2026).
- Facturation : Splyce ne sera **pas** porté par la PT indonésienne (décidé le 23/10/2026) ; structure qui vend
  (et qui ouvre le compte Meta Business pour l'agent WhatsApp) encore à préciser.
- Données personnelles : RGPD, UU PDP (Indonésie), Privacy Act (Australie).

## État au 20/10/2026
Cadrage fait (`docs/cadrage.md`). Décisions depuis : **Supabase direct** (pas de phase Airtable),
**produit en libre-service** (Pierre vend le système, ne tient la compta de personne),
segment à trancher après 5–10 entretiens (base déjà prévue pour les gestionnaires).

Code dans `app/` (Next.js 16 + Supabase), dépôt privé GitHub `PTK056/ONBA-books` ; `main` = `core-schema`.
**En ligne** sur https://app.splyce.me (domaine `splyce.me`, Vercel Hobby, déploiement à chaque push sur `main` ;
`onba-books.vercel.app` reste actif). Connexion par e-mail ouverte à tous (Resend).
Serveur Vercel à Tokyo (`hnd1`, `app/vercel.json`), à côté de la base Supabase (`ap-northeast-1`) :
ne pas changer l'un sans l'autre.
Projet Supabase `wnmukybwihyrxzcbfbdz` lié (CLI connectée sur le Mac de Pierre) ; migrations et
Edge Function `read-receipts` déployées. L'app tourne aussi en local (`npm run dev` dans `app/`) ;
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
- **Assistant** (`docs/agent-whatsapp.md`) : serveur MCP `/api/mcp` (OAuth Supabase, testé avec Claude) et **agent Telegram
  @ONBAbooks_bot** : reçus (photo/PDF → Review), dépenses dictées, séjours, pense-bêtes, chiffres du mois, notes vocales
  (transcription OpenAI), brief du matin. WhatsApp = même cœur, adaptateur à écrire (compte Meta Business).
- **Vraies données** (26/10/2026) : organisation « Onba Property Management » (compte e-mail de la villa), migrée du Control
  Room Airtable et vérifiée au rupiah près ; le chat Telegram y est relié. Bac à sable pour les essais : organisation « Casa ONBA ».
- **Team** (27/10/2026, `docs/module-staff.md`) : staff et freelances, mode de paie par personne (mensuel + base/extras, heure,
  prestation), journal « qui a bossé quand », paie de la période du 26 au 25 préparée puis payée (→ dépense), rappel dans le brief.
- **Brief du matin** sur Claude Haiku, dans la langue de Pierre ; ne relance que les justificatifs du mois et du précédent.
- **Occupation** comptée à partir de la première nuit louée de chaque villa ; Overview s'ouvre sur le mois en cours.

Vérifications : `npm test` (parser Airbnb), `npm run test:db` (SQL sur PGlite), `npm run check:queries`
(requêtes de l'app rejouées contre le projet), `npx tsc --noEmit`, `npx eslint`, `npx next build`.
Pages de démo sans connexion (dev seulement) : `/dev/overview`, `/dev/period`, `/dev/review`, `/dev/import`, `/dev/statement`.

Secrets hors dépôt : clé Anthropic dans `~/.config/onbabooks/anthropic_key` (aussi en secret de la
fonction Supabase) ; `app/.env.local` (URL + clé publique Supabase).

## Prochaines étapes (ordre proposé)
0. ~~Sécurité avant d'inviter d'autres utilisateurs~~ : faite (27/10) — quotas IA, en-têtes, consentement OAuth, captcha
   (`docs/securite.md`). Reste « ensuite » : MFA admins, liens de partage révocables, anciennes clés Supabase.
1. ~~Mise en ligne~~ faite (26/10, `splyce.me`). Passer Vercel en Pro avant le premier client payant.
2. Rapprochement bancaire Danamon (Claude lit bien les relevés PDF).
2 bis. Agent WhatsApp (adaptateur sur le cœur Telegram) quand le compte Meta Business est prêt.
3. Couche gestionnaire : frais de gestion, relevés propriétaires à la marque, accès propriétaires.
4. Entretiens prospects (questions dans `docs/cadrage.md` §6).
