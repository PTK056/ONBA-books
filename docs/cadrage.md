# Cadrage — v0.1 (08/10/2026)

Document de travail interne. Les noms de fonctionnalités et les questions prospects
sont en anglais (ce sont des éléments du produit) ; le reste est en français.

## 1. Ce qu'on vend, en une phrase

> Splyce turns receipts, bookings and bank statements into clean monthly books
> and owner statements for short-term-rental villas — without an accountant chasing you.

Deux promesses, une par cible :
- **Propriétaire** : « je sais enfin ce que ma villa me rapporte, mois par mois, preuves à l'appui ».
- **Gestionnaire** : « je sors un relevé propriétaire propre et justifié pour chaque villa en fin de mois, sans tableur ».

Le relevé propriétaire mensuel (aujourd'hui la synthèse PDF de Casa ONBA) est la pièce centrale pour les gestionnaires : c'est ce qu'ils doivent produire, et ce qui leur coûte du temps.

## 2. Tri des fonctionnalités

Légende : **Cœur** = pour tous, toujours actif · **Réglage** = même code, paramétré par organisation ·
**Module** = activable (et éventuellement facturé à part) · **Casa** = propre à Casa ONBA, ne passe pas dans le produit tel quel.

### 2.1 Ce qui existe dans le Control Room

| Onglet actuel | Classement | Ce que ça devient dans Splyce |
|---|---|---|
| Overview | Cœur | Tableau de bord par villa et consolidé par organisation. |
| Months | Cœur | Clôture mensuelle : statut (ouvert / à valider / clôturé), verrouillage après clôture. |
| Costs | Cœur + Réglage | Saisie et liste des dépenses. Plan de catégories = réglage (modèle par défaut fourni). |
| Evidence | Cœur | Justificatifs rattachés aux dépenses ; signalement des dépenses sans preuve. |
| Add a receipt + moteur de tickets | Cœur | Photo → lecture IA → lot à valider. C'est le différenciateur. Doit quitter le Mac de Pierre (cloud). |
| Stays (CSV Airbnb) | Cœur | Import des réservations Airbnb. Booking.com, VRBO, réservations directes = **modules** d'import ultérieurs. |
| Monthly PDF summary | Cœur | Devient le **Owner statement** : marque du gestionnaire, frais de gestion, solde dû au propriétaire. |
| Reimbursements | Module « Advances » | Généralisation des avances `-OA` : qui a avancé quoi (propriétaire, gestionnaire, staff), qui doit combien. |
| Bank (Danamon PDF) | Module « Bank reconciliation » | Rapprochement des relevés. Un lecteur par format de banque ; Danamon = premier lecteur, réutilisable pour tout client Danamon. |
| Team (paie) | Module « Payroll » | Salariés, paie mensuelle. Les règles locales (BPJS, THR en Indonésie ; superannuation en Australie) = sous-modules par pays. |
| Ask about the numbers | Module « Ask » | Questions en langage naturel sur les chiffres. Coût IA variable → module payant ou réservé à l'offre haute. |

### 2.2 Réglages par organisation

- Devise de saisie par villa (IDR, AUD, USD, EUR…) et devise de reporting ; source des taux de change.
- Langue de l'interface et des relevés (anglais au lancement ; indonésien ensuite).
- Fuseau horaire, début de l'exercice, format de date.
- Plan de catégories de dépenses et de revenus.
- Gestionnaire : frais de gestion (% des revenus nets, forfait, ou mixte) et base de calcul.
- Identité visuelle du relevé (logo, nom, mentions légales).
- Rôles et accès (voir §3).
- Règles de validation (seuil au-dessus duquel une dépense exige une preuve, double validation…).

### 2.3 Propre à Casa ONBA (reste en dehors)

- Les données elles-mêmes : Kadek, Alit, villa, historique.
- La convention de suffixe `-OA` (remplacée par le module Advances, qui la gère en données structurées).
- Les obligations PT PMA (LKPM, impôts indonésiens). Piste de module « Indonesia compliance » plus tard, mais hors périmètre de départ : c'est du conseil, pas de la tenue de comptes.
- L'IDR comme valeur codée en dur, Danamon comme seule banque : à transformer en réglage et en lecteur.

### 2.4 Ce qui manque pour les gestionnaires (absent du Control Room)

- Multi-villas et vue consolidée.
- Accès propriétaire en lecture seule, limité à ses villas.
- Copropriété (une villa, plusieurs propriétaires avec quote-parts).
- Calcul des frais de gestion et du solde à reverser.
- Envoi des relevés aux propriétaires (e-mail + lien).
- Journal des modifications (qui a changé quoi) : indispensable dès qu'un tiers lit les comptes.

## 3. Modèle de données

Chaque table porte `organization_id`. C'est la clé de l'isolation entre clients (Row Level Security sur Postgres/Supabase).

```
Organization ──< Membership >── User           role: admin | staff | owner_viewer
     │
     ├──< Villa ──< VillaOwnership >── Owner    share_pct ; Owner peut être lié à un User
     │      │
     │      ├──< Stay            (plateforme, dates, nuits, brut, commissions plateforme, net)
     │      ├──< Transaction     (date, montant, devise, catégorie, sens, statut, payé_par)
     │      │        └──< Evidence (fichier, champs lus par l'IA, confiance)
     │      ├──< MonthClose      (mois, statut, clôturé_par, clôturé_le)
     │      └──< OwnerStatement  (mois, propriétaire, PDF, envoyé_le)
     │
     ├──< ReceiptBatch ──< ReceiptItem   (lot à valider issu du moteur de tickets)
     ├──< Category                       (plan de catégories)
     ├──< Settings / ModuleActivation
     │
     ├── [Advances]  Advance (avancé_par, montant, remboursé_par Transaction)
     ├── [Bank]      BankAccount ──< BankStatement ──< BankLine ── match → Transaction
     └── [Payroll]   Employee ──< PayrollRun ──< PayrollLine → Transaction
```

Points de conception :
- **Transaction est le pivot.** Paie, remboursements, frais de gestion et lignes bancaires finissent tous en transactions ; le relevé propriétaire ne lit que `Transaction` + `Stay`.
- **Montants stockés en devise d'origine + taux du jour + montant converti.** Pas de reconversion rétroactive.
- **Mois clôturé = lecture seule.** Une correction passe par une écriture d'ajustement datée du mois ouvert.
- Les modules ajoutent des tables mais ne modifient pas celles du cœur.

## 4. Pilote : un point bloquant à trancher

Le Control Room tourne comme artifact claude.ai qui passe par **le connecteur Airtable de Pierre**. Il ne peut pas être remis tel quel à un client : il faudrait que chaque client ait Claude, son propre connecteur, et un artifact à lui. Et le moteur de tickets tourne sur le Mac de Pierre.

Principe fixé : **Splyce est un produit en libre-service.** Le client l'utilise lui-même ; Pierre vend et maintient le système, il ne tient la compta de personne. Le pilote doit donc déjà être une vraie application, avec ses comptes utilisateurs, et le moteur de tickets doit tourner dans le cloud dès le départ.

Deux options :

| Option | Pour | Contre |
|---|---|---|
| B. Web app Next.js sur l'API Airtable, une base par client | Fidèle à la décision « Airtable d'abord » ; le client peut voir ses données dans Airtable | Airtable ne sait pas restreindre un utilisateur à ses villas : les rôles et l'accès propriétaire sont à coder dans l'app, puis à recoder sur Postgres. Un compte Airtable payant par client, des quotas d'API, et une base à dupliquer à chaque nouveau client |
| C. Directement Supabase + Next.js, version minimale (cœur seulement) | Rôles, isolation entre clients (RLS) et authentification fournis ; rien à refaire ensuite ; un seul back-end pour tous les clients | Il faut écrire le schéma et la migration tout de suite ; pas d'interface « tableur » pour corriger les données à la main |

Dans les deux cas, le front-end Next.js et le moteur de tickets sont à construire : seule la couche de données change.

**Décision (08/10/2026) : C, Supabase direct.** Avec des clients autonomes, l'essentiel du travail du pilote porte sur les comptes, les rôles et l'isolation des données : c'est précisément ce qu'Airtable ne fournit pas et qu'il aurait fallu refaire à la migration. Il n'y a plus de phase Airtable.

## 5. Piste de prix (hypothèses à tester, pas de chiffres validés)

Structure proposée : **abonnement par villa et par mois**, dégressif, + frais de mise en place.

| Offre | Pour qui | Contenu | Hypothèse de prix |
|---|---|---|---|
| Owner | 1–2 villas | Cœur | ~ 39 USD / villa / mois |
| Manager | 3+ villas | Cœur + accès propriétaires + relevés de marque + frais de gestion | ~ 25 USD / villa / mois, minimum 5 villas |
| Modules | Tous | Bank, Payroll, Advances, Ask | ~ 5–15 USD / villa / mois chacun, ou inclus dans une offre « Pro » |
| Mise en place | Tous | Import de l'historique, plan de catégories, premier mois accompagné | Forfait unique, ~ 150–500 USD |

À vérifier avant de figer :
- Prix des outils concurrents (logiciels de gestion locative avec relevés propriétaires, outils de notes de frais) — non étudiés à ce stade.
- Coût réel par villa : lecture IA des tickets (volume mensuel × coût par ticket), hébergement, Stripe.
- Ce que les gestionnaires facturent déjà aux propriétaires pour la comptabilité : si c'est refacturable, le prix supportable est plus élevé.
- Facturation : par quelle entité (les codes KBLI de PT ONBA ne couvrent probablement pas le logiciel — cf. contexte).

## 6. Questions pour les 5 à 10 premiers prospects

Règle : faire parler de ce qu'ils font **aujourd'hui**, pas de ce qu'ils achèteraient. Pas de démo avant la fin de l'entretien.

**Current process**
1. Walk me through what happens to a receipt from the moment money is spent until it shows up in your books.
2. How do you produce the monthly figures (or owner statement) today? Which tools, who does it, how long does it take?
3. When was the last time a number was wrong or disputed? What happened?
4. How do you handle cash advances — staff or owner paying out of pocket?
5. How do you reconcile with the bank today, if at all?

**Pain and stakes**
6. What part of month-end do you dread the most?
7. Has an owner (or your accountant, or the tax office) ever asked for proof you couldn't find quickly?
8. What does bookkeeping cost you today — in hours, and in fees to an accountant or staff?

**Buying**
9. Have you tried other tools for this? Why did you stop or keep using them?
10. Who would decide to pay for a tool like this, and who would use it day to day?
11. *(Managers)* Do you charge owners for reporting today? Is it in your management fee?

**Setup**
12. How many villas, which booking platforms, which banks, which currencies?
13. Who takes the photos of receipts — you, a villa manager, staff? On what phone, in what language?

À noter après chaque entretien : taille, plateformes, banques, outil actuel, douleur n°1, a-t-il déjà payé pour résoudre ça, accepterait-il un pilote.

## 7. Décisions à prendre (par Pierre)

1. ~~Pilote : Airtable (B) ou directement Supabase (C) ?~~ → **C, Supabase direct** (08/10/2026).
2. Premier segment visé : propriétaires seuls ou gestionnaires ? **Pas de prospect à ce jour (08/10/2026) → on ne tranche pas dans l'abstrait** :
   - On construit le cœur commun, avec une base pensée d'emblée pour plusieurs villas et des rôles. Le surcoût pour les gestionnaires (rôle propriétaire, frais de gestion, relevé à la marque) est estimé à un quart à un tiers de la v1 et s'ajoute ensuite sans reprise du schéma.
   - Casa ONBA est le premier utilisateur réel d'Splyce, sur une organisation séparée et sans lien avec la base Airtable. C'est la démo des entretiens.
   - En parallèle : 5–10 entretiens, mélangeant propriétaires et gestionnaires. Pistes : groupes de propriétaires et d'hôtes à Bali, entourage de Pierre (voisins, notaire, comptable, agent immobilier), petits gestionnaires de 3 à 15 villas.
   - Hypothèses à tester : les propriétaires qui passent par un gestionnaire voudraient-ils l'outil pour le *contrôler* ? Les gestionnaires voient-ils ONBA comme un concurrent ?
   - Critère de choix après les entretiens : **qui a déjà payé** (outil, comptable, temps salarié) pour résoudre ce problème ?
3. Réserver maintenant onbabooks.com (+ onba.io ?) — quelques dizaines de dollars, évite de perdre le nom.
4. Entité de facturation (PT ONBA avec nouveau KBLI, autre structure ?) — à voir avec le conseil fiscal.
5. Liste des 5–10 prospects à contacter (réseau Bali en premier).
6. Langue des relevés propriétaires au lancement : anglais seul, ou anglais + indonésien ?
