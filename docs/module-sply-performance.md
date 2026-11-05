# Module Sply Performance — design

Demande de Pierre (06/11/2026) : un agent qui suit la performance, les objectifs, et ce qu'il faut faire pour un bon
ROI ; il se lance à la clôture de Sply Accountant. « Design et pousse le max. »

## L'idée en une phrase

Quand un mois est clôturé (donc des chiffres justes), Sply Performance calcule les indicateurs de chaque villa, les
compare à l'historique et aux objectifs, et propose **3 actions chiffrées au plus** pour le mois qui vient. Il suit
ces actions le mois suivant : faites ou non, et avec quel effet.

C'est la troisième voix de l'équipe : 🧾 Sply Accountant fait les comptes, 📈 Sply Performance dit quoi en faire, Sply
au quotidien.

## Principes

1. **Le code calcule, Claude explique.** Chaque chiffre vient du moteur d'indicateurs, jamais du modèle. Claude reçoit
   les indicateurs déjà calculés et n'écrit que le diagnostic et les actions. Chaque action cite les indicateurs qui la
   justifient (par leur clé), et le code vérifie que ces clés existent.
2. **Sur des comptes clôturés seulement.** Un mois ouvert peut encore bouger : pas de rapport dessus (sauf l'aperçu en
   cours de mois, marqué comme tel).
3. **Peu, mais utile.** 3 actions au plus, chacune avec un impact estimé en argent, un effort (faible, moyen, fort) et
   une échéance. Pas de liste de conseils génériques (« améliorez vos photos »).
4. **Il propose, Pierre décide.** Une action devient une tâche Splyce d'un clic (bouton « Add to my tasks »). Les
   objectifs aussi : Sply les propose à partir de l'historique, Pierre les valide ou les corrige.
5. **Self-serve.** Tout est réglable par l'organisation (capital investi, objectifs, nuits bloquées) : rien de propre
   à Casa ONBA dans le code.

## Le déclencheur

- **À la clôture** : quand le dernier lieu d'un mois est clôturé (bouton « Close » de Sply Accountant, ou Overview),
  le rapport de ce mois est généré en arrière-plan, puis envoyé sur Telegram. Un mois rouvert puis reclôturé donne un
  nouveau rapport, qui remplace l'ancien.
- **En janvier**, à la clôture de décembre : en plus, le bilan de l'année et la proposition d'objectifs pour la
  nouvelle.
- **À la demande** : bouton « Generate report » dans l'onglet Performance (mois clôturés seulement), et `/performance`
  sur Telegram.

## A. Le moteur d'indicateurs (code pur, testé)

Par villa et pour l'ensemble, pour le mois M :

| Indicateur | Calcul |
|---|---|
| Nuits disponibles | jours du mois − nuits bloquées (propriétaire, travaux) |
| Nuits vendues | nuits des séjours confirmés, réparties par mois (un séjour à cheval compte dans chaque mois) |
| Occupation | nuits vendues ÷ nuits disponibles |
| ADR (prix moyen par nuit) | revenu d'hébergement ÷ nuits vendues |
| RevPAR | revenu d'hébergement ÷ nuits disponibles |
| Revenu brut, frais de plateforme, revenu net | depuis les écritures validées (catégories de revenu) |
| Charges par catégorie | écritures validées ; part du revenu ; coût par nuit vendue |
| NOI (résultat d'exploitation) | revenus − charges d'exploitation (hors investissement) |
| Marge | NOI ÷ revenu brut |
| Mix des canaux | Airbnb / direct / autres : part des nuits, du revenu, et frais de plateforme évités en direct |
| Séjours | nombre, durée moyenne, délai de réservation (quand la date de réservation est connue : e-mail Airbnb) |
| ROI | NOI des 12 derniers mois ÷ capital investi dans la villa (réglage) ; et rendement mensuel annualisé |

Comparaisons, toutes calculées :
- le même mois l'an dernier (dès qu'il existe : Casa ONBA a des écritures depuis octobre 2024) ;
- la moyenne des 3 et des 12 derniers mois ;
- les 12 derniers mois glissants contre les 12 précédents ;
- l'objectif du mois, et le cumul de l'année contre l'objectif annuel.

Détections, calculées elles aussi (Claude ne fait que les commenter) :
- **charges anormales** : une catégorie à plus de 30 % au-dessus de sa moyenne sur 6 mois, ou une dépense nouvelle
  récurrente ;
- **trous dans le calendrier** : les nuits libres des 60 prochains jours, et les « nuits orphelines » (1 à 2 nuits
  coincées entre deux séjours, invendables avec la durée minimale actuelle) ;
- **rythme des réservations** : les nuits déjà réservées pour les 3 prochains mois, comparées à la même date l'an
  dernier (pour les séjours dont on connaît la date de réservation) ;
- **prix** : l'ADR par jour de semaine et par durée de séjour, l'écart avec l'an dernier ;
- **trésorerie** : versements Airbnb en retard, et argent sorti mais pas encore rattaché.

## B. Les objectifs (table `performance_goals`)

Par villa et par année, avec une ventilation mensuelle : occupation, ADR, revenu net, plafond de charges (en part du
revenu), ROI visé.
- Sply propose : l'an dernier + saisonnalité, corrigé de la tendance des 12 derniers mois. Pierre valide d'un clic, ou
  corrige dans l'onglet Performance.
- Réglage par villa : **capital investi** (achat, travaux, mobilier ; date), indispensable au ROI. Sans lui, le rapport
  montre le NOI et la marge, et demande le chiffre une fois.

## C. Le rapport (table `performance_reports`)

Un rapport par organisation et par mois clôturé : les indicateurs (JSON, figés au moment de la clôture), le diagnostic,
les actions, la version du moteur, le coût (jetons).

Les actions (table `performance_actions`) : titre, pourquoi (indicateurs cités), impact estimé (montant et hypothèse),
effort, échéance, statut (proposée, acceptée → tâche, faite, écartée), et le résultat mesuré le mois suivant (« prix
week-end +8 % : ADR week-end +6 %, occupation stable : +2,1 M IDR »).

## D. L'appel à Claude

Un appel par rapport, sur le modèle le plus capable (Opus 5.5 : une fois par mois, le coût reste de quelques
centimes). Entrée : les indicateurs, les comparaisons, les détections, les objectifs, les actions du mois précédent et
leur résultat. Sortie structurée (zod), vérifiée par le code :
- `headline` : le mois en une phrase ;
- `wins`, `issues` : 3 au plus chacun, chacun avec les clés des indicateurs cités ;
- `actions` : 3 au plus ; `title`, `why`, `metrics` (clés), `impact` (montant et hypothèse), `effort`, `due` ;
- `goals_comment` : où l'on en est des objectifs.

Le code refuse une action qui cite une clé inconnue, ou un impact sans hypothèse. Le texte de la banque et les
descriptions ne lui arrivent qu'agrégés (par catégorie), jamais en texte brut : pas d'injection possible par là.

## E. Telegram : 📈 Sply Performance

Un message court après la clôture :
- la phrase du mois ;
- 4 chiffres : occupation, ADR, revenu net, NOI (avec l'écart à l'an dernier et à l'objectif) ;
- les actions, chacune avec un bouton « ➕ Add to my tasks » ;
- un lien vers le rapport complet.

Le mois suivant, il commence par le bilan des actions : « Le mois dernier : 2 actions faites, effet mesuré +3,4 M IDR. »

## F. L'onglet Performance (app)

- **En haut** : les 4 chiffres du mois, l'objectif de l'année (jauge), le ROI.
- **Les courbes sur 12 mois** : occupation, ADR, RevPAR et NOI, avec l'an dernier en pointillé.
- **Les charges par catégorie**, avec les anomalies en évidence.
- **Le calendrier des 60 prochains jours**, avec les trous et les nuits orphelines.
- **Les actions** : en cours, faites (avec leur effet), écartées.
- **L'historique des rapports**, et les réglages (capital investi, objectifs, nuits bloquées).

## G. Données à compléter (le rapport dit ce qui manque, il n'invente pas)

- **Nuits bloquées** (propriétaire, travaux) : sans elles, l'occupation est sous-estimée. Un séjour « owner » ou des
  blocages saisis dans l'onglet Performance.
- **Capital investi** par villa : pour le ROI.
- **Date de réservation** : connue pour les séjours venus des e-mails Airbnb ; pour les autres, le rythme des
  réservations n'est pas calculé.
- **Comparaison au marché** (prix et occupation des villas voisines) : pas de source aujourd'hui. Une source payante
  (type AirDNA) serait une nouvelle dépendance, à décider plus tard.

## Étapes

- **V1** : le moteur d'indicateurs et ses comparaisons, les objectifs et le capital investi, le rapport à la clôture
  (Telegram et onglet), les actions transformables en tâches, la mesure de leur effet le mois suivant.
- **V2** : les détections de calendrier (trous, nuits orphelines) et le rythme des réservations, le bilan annuel et les
  objectifs proposés en janvier, l'aperçu en cours de mois.
- **V3** : les prix recommandés par période, la comparaison au marché (si une source est retenue), le rapport
  propriétaire (pour les villas gérées pour des tiers).

## Décisions de Pierre (05/11/2026)

1. **Capital investi** de Casa ONBA : bail 500 M IDR (2 × 250 M, avril 2025 → mars 2027, amorti au mois dans les
   comptes) et mobilier 99,8 M IDR (mai 2025) ; le reste, ce sont les charges du mois. Tout est déjà dans les écritures :
   le ROI se lit sur le résultat cumulé.
2. **Objectifs** : le seuil, pessimiste, est d'être à zéro (résultat cumulé) fin avril 2027. Pierre réinvestira une année
   de bail en avril 2027, pour sortir avec un ROI positif en 2028. D'où deux objectifs « résultat cumulé ≥ 0 à une date »
   (pas d'objectifs d'occupation ou de prix : Sply en déduit ce qu'il faut par mois).
3. **Nuits bloquées** : oui, par exemple le séjour des propriétaires du 20 au 29/10/2026 ; à saisir (onglet
   Performance, ou sur Telegram : « on loge à la villa du … au … »).

## Livré : V1 (05/11/2026)

- **Migration `20261108000000_performance`** : `villa_blocks`, `performance_goals`, `performance_reports` (un par mois,
  verrou `performance_report_claim`), `performance_actions` (`performance_action_accept` → une tâche, une seule fois),
  quota IA `performance` (10 par mois). Tests : `supabase/tests/performance.sql`.
- **Moteur** (`lib/performance/metrics.ts`, pur, testé) : nuits disponibles (depuis la première nuit vendue, moins les
  nuits bloquées), occupation, ADR, RevPAR, revenus, frais, charges par catégorie, résultat, **résultat d'exploitation**
  (avant les coûts payés d'avance et amortis au mois, comme le bail : détectés car déjà passés en écritures futures),
  canaux, durée et délai de réservation (date de l'e-mail de confirmation) ; comparaisons (même mois l'an dernier,
  3 mois avant, 12 mois glissants) ; charges anormales ; 60 prochains jours (trous, nuits orphelines, même période l'an
  dernier).
- **Objectifs** : résultat cumulé depuis une date, séjours déjà réservés, coûts déjà engagés (le bail à venir), montant
  prévu non encore en compte (le prochain bail), **ce qu'il faut par mois**, le rythme des 3 derniers mois, la
  projection si les mois restants font comme les mêmes mois de la dernière année connue, le ROI.
- **Rapport** (`lib/performance/report.ts`, `analyze.ts`) : un appel Opus 5.5 (effort high, sortie structurée, fallback
  serveur) ; Claude ne reçoit que des chiffres nommés ; un point ou une action qui cite une clé inconnue est écarté ; une
  estimation sans hypothèse est retirée. Écrit à la clôture du dernier lieu du mois (Overview ou bouton de Sply
  Accountant), réécrit à la demande.
- **Telegram** (`render.ts`) : 📈 Sply Performance, 4 chiffres, la ligne de chaque objectif, ce qui va, ce qui est à
  surveiller, les actions avec « ➕ Add to my tasks » (`pa:<id>`), le bilan des actions du mois d'avant ; `/performance`.
- **Onglet Performance** (admins) : chiffres du mois, objectifs avec courbe (cumul et projection), actions, calendrier
  des 60 jours, tableau mois par mois, charges anormales, données manquantes, réglages (objectifs, nuits bloquées).
- **Chat** : `block_nights`, `unblock_nights`, `performance_summary`.
- **Onglet refait pour aller au but (05/11/2026)** : mois ‹ › ; le verdict (la phrase, puis par objectif, en onglets :
  « Short by X a month », il faut / on fait, courbe survolable) ; les actions (gain total possible, bilan du mois
  d'avant) ; 4 chiffres avec mini-courbe, un clic ouvre le mois par mois (tableau replié dedans) ; 60 jours avec le plus
  grand trou en clair ; « To watch / Went well / Unusual expenses » en onglets ; réglages repliés. Composants :
  `components/performance/` (`PerformanceView`, `GoalPanel`, `Figures`, `Settings`, `ui`).

Premier passage à blanc sur les données réelles (octobre 2026, sans le séjour de Beck annulé) : occupation 54,5 %
(64,5 % un an plus tôt), il faut 30,5 M IDR par mois avant bail jusqu'en avril, le rythme est de 21,6 M ; comme l'an
dernier, on finirait à −67 M IDR. Trou de 41 nuits du 24/11 au 04/01.

Reste pour V2 : rythme des réservations (comparé à la même date l'an dernier), bilan annuel de janvier, aperçu en cours
de mois, nuits bloquées dans l'occupation d'Overview.
