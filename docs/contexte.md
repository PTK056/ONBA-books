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
- **Back-end en deux temps** : pilote sur Airtable (un compte payant par client) → SaaS sur Postgres/Supabase payant, avec Row Level Security, une web app (Next.js/Vercel), Stripe, et le moteur de tickets dans le cloud.

## Risques notés
- ONBA est aussi une société de gestion locative : un frein possible pour vendre aux gestionnaires concurrents.
- Facturation : les codes d'activité (KBLI) de PT ONBA ne couvrent probablement pas le logiciel.
- Données personnelles : RGPD, UU PDP (Indonésie), Privacy Act (Australie).

## Prochaine étape
`docs/cadrage.md` : tri des fonctionnalités (cœur commun / réglages / modules / propre à Casa ONBA),
modèle de données, piste de prix, questions pour les 5 à 10 premiers prospects.
