# Module Réservations par e-mail (Gmail)

Conception validée le 30/10/2026 ; **V1 codée le 30/10/2026** (pas encore en ligne : migration à appliquer, compte Composio à créer). Remplace le MCP Airbnb : les séjours arrivent tout seuls à partir
des e-mails Airbnb du client, sans attendre l'import CSV. Module activable par organisation (`module_activations`, clé `gmail_bookings`).

## Principes (décidés avec Pierre)
- **Bouton « Connect Gmail »** dans un onglet **Connections** (admins seuls) : un clic, pas de filtre à configurer chez le client.
- Splyce **ne lit que les e-mails venant d'Airbnb** (requête Gmail limitée à l'expéditeur), **une fois par jour**.
- **Pas d'IA pour lire** : les e-mails Airbnb suivent des modèles fixes, un lecteur par type, testé sur de vrais e-mails.
  L'IA ne sert qu'en secours quand un modèle change, et ce qu'elle lit passe par **Review**, jamais en écriture directe.
- **Rien n'est comptabilisé sans passer la barrière stricte** (§3). Le doute va au journal « non reconnu », pas dans les comptes.
- **Le CSV Airbnb reste la référence** : même clé (villa + plateforme + code), il écrase ce qui vient des e-mails.
- Plus tard, pour les clients hors Gmail : adresse de transfert vers `in.splyce.me` (même porte d'entrée, mêmes lecteurs).

## 1. Connexion Gmail
Le code ne dépend que d'une **source d'e-mails** (`lib/mail/source.ts`) : `connect`, `disconnect`, `fetch(query, depuis)`
→ e-mails bruts avec leur identifiant. La barrière, les lecteurs et l'écriture ne savent pas d'où vient l'e-mail.

**Pilote (décidé le 30/10/2026) : Composio, connexion gérée** — comme Owl.
- Le client consent à l'app Google de Composio, déjà vérifiée par Google (audit CASA de leur côté) : pas de projet
  Google Cloud chez Splyce, pas d'écran « app non vérifiée », pas de plafond de 100 comptes.
- Splyce garde seulement l'identifiant de connexion Composio (`connected_account_id`) par organisation ; les jetons Google
  restent chez Composio. Clé API Composio en secret serveur (`COMPOSIO_API_KEY`), jamais dans la base.
- Volume : une relève par jour et par organisation (~30 appels par mois), dans l'offre gratuite. Tarifs à revérifier avant d'ouvrir.
- Limites acceptées pour le pilote : l'écran de consentement affiche « Composio » ; droits Gmail larges (lecture, envoi,
  gestion) alors que Splyce ne fait que lire ; Composio est **sous-traitant** à citer dans la politique de confidentialité et le DPA.

**Ensuite, avant d'ouvrir largement aux clients payants** : notre propre app Google (nom Splyce, seul droit `gmail.readonly`,
vérification Google + audit CASA annuel), branchée soit dans Composio (« own credentials »), soit en direct derrière la
même source. Jeton alors chiffré chez nous (AES-256-GCM, `lib/channels/crypto.ts`). Demander à Owl leur retour d'expérience.

## 2. Relève quotidienne
- Cron Vercel une fois par jour (le plan Hobby n'en permet pas plus), par organisation connectée.
- Requête : `from:(airbnb.com) newer_than:3d` + curseur (`historyId` ou date du dernier message traité). La marge de 3 jours
  rattrape un cron manqué ; l'identifiant du message Gmail empêche tout double traitement.
- Bouton **« Check now »** dans Connections pour forcer une relève.

## 3. Barrière stricte et classement
Établi le 30/10/2026 sur 10 vrais e-mails de la villa (`private/*.eml`, hors dépôt), dont **la même réservation vue
trois fois** : demande d'info, demande de réservation puis confirmation de Beck (30/10 → 6/11).

**Trois verrous, dans l'ordre :**
1. **Authenticité** : `Authentication-Results` de Gmail avec `dkim=pass header.i=@automated.airbnb.com`.
   (Les messages de voyageurs viennent d'`express@airbnb.com` : jamais lus.)
2. **Modèle Airbnb** : chaque lien de l'e-mail porte `c=.pi80.pk<base64>`, qui décodé donne le **nom du modèle** Airbnb.
   C'est le classement, pas l'objet (qui change de langue et de formulation) :

| Modèle (décodé) | Objet observé | Type | Effet |
|---|---|---|---|
| `booking/host/ReservationHostConfirmationTemplate` | « Reservation confirmed - Beck arrives Oct 30 » | `confirmed` | crée le séjour, `booked` |
| `PAYMENTS_HOST_PAYOUT_SENT_BASE_2025` | « We sent a payout of Rp1,938,587.00 IDR » | `payout` | versement, `paid` |
| `booking/reservation_host_pending` | « Pending: Reservation Request at … » | `request` | ignoré |
| `booking/v2_migration/host_initial_inquiry` | « Inquiry for … », « Same-day inquiry for … » | `inquiry` | ignoré |
| `MESSAGING_NEW_MESSAGE_EMAIL_DIGEST` (express@) | « RE: Reservation for … » | message | ignoré |
| `HOST_REVIEW_REMINDER_DIGEST`, `home_reviews/…` | « Write a review for Emil » | avis | ignoré |
| `CANCELLATIONS_RESERVATION_CANCELED_BY_GUEST_TO_HOST` | « Canceled: Reservation HMT5Z9QN4N for September 18 – 21 » | `canceled` | séjour `canceled`, garde le dédommagement |
| `reservation/alteration/alteration_requested` | « Agathe wants to change their reservation » | `alteration_request` | journal seulement |
| `ALTERATION_ACCEPTED` | « Reservation updated » | `altered` | séjour marqué « modifié, en attente du versement » |
| `MESSAGING_NEW_MESSAGE_EMAIL_DIGEST` (no-reply@supportmessaging) | « New message from Airbnb Support » | message du support | alerte si un code connu y figure, jamais d'écriture |

**Annulation par le voyageur** : code, dates (sans année) et « your payout has been updated to €191.78 » (net hôte selon
la politique d'annulation, versé 24 h après la date d'arrivée prévue). Le séjour passe à `canceled` : ses nuits ne comptent
plus dans l'occupation (le calendrier est rouvert), le montant gardé reste un revenu, confirmé ensuite par l'e-mail de
versement (taux réel). « Updated to €0.00 » ou un remboursement complet fait par l'hôte → plus aucun revenu.
Annulation d'un séjour que Splyce ne connaît pas (avant la connexion) → journal seulement.

**Modification — suivi complet d'Agathe (HM8MB8RFBM), une nuit de plus :**
1. *Demande* (`alteration_requested`) : prénom, annonce, dates d'origine (29/09 → 11/10) et demandées (→ 12/10), sans code
   ni montant. Rien ne change, simple journal.
2. *Acceptée* (`ALTERATION_ACCEPTED`, « Reservation updated ») : ni dates ni montants, mais le **code est dans le lien**
   `hosting/reservations/details/HM8MB8RFBM`. Le séjour est marqué « modifié, en attente du versement ».
3. *Versement de la nuit ajoutée* : une **deuxième ligne pour le même code**, 74.26 EUR → Rp 1 491 758 (≈ 20 088.3),
   avec les **nouvelles dates** (9/29/2026 - 10/12/2026). Le séjour prend la nouvelle date de départ et le complément
   s'ajoute (890.87 + 74.26 = 965.13 EUR net, deux taux). Le versement ne donne que le net : les frais Airbnb du
   complément sont estimés au même pourcentage que la réservation d'origine, marqués « estimé », et l'import CSV corrige.

**Message du support Airbnb** (texte libre, ex. « we have cancelled the reservation HM2BER4THH with the guest Emil
without any cancellation consequences ») : jamais lu comme une instruction comptable. Si un code connu y figure, le brief
le signale avec un bouton : « Airbnb Support wrote about HM2BER4THH (Emil). Cancel this stay? » → **Cancel stay** /
**Keep**. C'est le cas réel de l'**annulation par l'hôte** : Pierre est passé par le support, c'est Airbnb qui a annulé
(sans pénalité), et le seul e-mail reçu est ce message.

**Filet de sécurité** : un séjour `booked` sans aucun versement 3 jours après la date d'arrivée est signalé dans le brief
(« No payout yet for HM… (Emil), arrived 12 Oct: canceled? »). Ça rattrape toute annulation dont l'e-mail aurait manqué.

3. **Contenu complet** (sur la partie texte de l'e-mail, présente dans tous) — pour `confirmed` : « CONFIRMATION CODE »
   suivi d'un code `HM[A-Z0-9]{8}`, Check-in / Checkout, « HOST PAYOUT », « YOU EARN », et le calcul qui tombe juste
   (room fee − ajustements − remises − frais = You earn, au centime). Pour `payout` : Payout ID, au moins une ligne
   (voyageur, montant, dates, annonce + ID, code), « Total paid ».

**Pièges vus dans les vrais e-mails :**
- La **demande de réservation contient déjà le code** (HMR55K89B9) et un « potential payout » de €425 (arrondi) :
  le code seul ne prouve rien, d'où le verrou par modèle.
- Les dates de la confirmation n'ont **pas d'année** (« Fri, Oct 30 ») : année déduite de la date de l'e-mail
  (arrivée avant la date d'envoi → année suivante). Le versement, lui, a des dates complètes (10/15/2026).
- Le **message du voyageur** est recopié dans la confirmation (David) : lire uniquement les blocs balisés,
  jamais le texte libre.
- Montants au format `€1,147.50`, `-€56.95`, `Rp18,096,227.00`.

S'il manque un seul élément attendu, l'e-mail est **non reconnu** : journal + alerte dans le brief de Sply.
Un modèle inconnu venant d'`automated@airbnb.com` est simplement journalisé (Airbnb en envoie beaucoup).

## 4. Deux e-mails, deux devises
**Confirmation (devise de l'annonce, ex. EUR)** : guest Beck, HMR55K89B9, 30/10 → 6/11, 7 nuits.
Brut = 670.00 − 56.95 − 100.50 = **512.55**, frais Airbnb **87.40**, net **425.15 EUR**. Le séjour compte tout de suite
pour l'occupation et le prix par nuit ; les écritures sont passées au **taux estimé** (même repli que l'import CSV) et marquées « estimé ».

**Versement (devise de la banque, ex. IDR)**, envoyé vers le lendemain de l'arrivée : lignes par réservation en EUR
(HMHFK5YXHD : 95.88 EUR) et total en IDR (Rp 1 938 587). **Taux du versement = total IDR ÷ somme des lignes EUR** (≈ 20 219),
comme pour le CSV. Les écritures du séjour sont recalculées au rupiah près, le séjour passe à `paid`.
Vérifié : HMHFK5YXHD 95.88 EUR → Rp 1 938 587 (≈ 20 218.9) ; HM8MB8RFBM 890.87 EUR → Rp 18 096 227 (≈ 20 313.0).
D'après Pierre, Airbnb fait **toujours un versement par réservation** (jamais vu autrement). Le lecteur accepte quand
même plusieurs lignes (taux = total ÷ somme), et si le total ne se recoupe pas, l'e-mail est non reconnu.
Un séjour payé en plusieurs fois (acompte, solde, prolongation, séjours longs payés au mois) a plusieurs versements : on les additionne.

**Banque** : le versement donne le montant IDR exact, la date d'arrivée prévue (« should arrive by ») et le Payout ID →
la ligne Danamon se rapproche automatiquement dans **Bank**.

## 5. Annonce → villa
Le nom de l'annonce (et son ID Airbnb, présent dans l'e-mail de versement) est relié à une villa **une seule fois** ;
correspondance enregistrée (`listing_villas`) et réutilisée aussi par l'import CSV, qui la redemande aujourd'hui à chaque fois.
Annonce inconnue → l'e-mail attend dans Connections avec « Choose the villa ».

## 6. Données
- `mail_connections` : organisation, fournisseur (`gmail`), intermédiaire (`composio` / `direct`), adresse Gmail,
  identifiant de connexion Composio ou jeton chiffré, statut, dernière relève, curseur, erreur.
- `inbound_emails` : organisation, connexion, identifiant du message (unique), date, objet, type, résultat
  (`booked`, `ignored`, `unrecognised`, `needs_villa`, `error`), séjour lié, extrait conservé (pas l'e-mail entier au-delà de 90 jours).
- `stays` : + `status` (`confirmed` / `canceled`), + `source` (`import` / `email` / `manual`). « Payé » = `payout_date` renseignée.
  `import_stays` reçoit `source` et `status` par séjour ; un séjour venu de l'export ou saisi à la main n'est jamais réécrit
  par un e-mail (seul son statut change). Les séjours annulés sortent de l'occupation, du relevé et de la répartition par nuits.
- `stay_payouts` : séjour, Payout ID, date, montant devise annonce, devise et montant versés, taux, arrivée prévue.
- `listing_villas` : organisation, plateforme, ID et nom d'annonce, villa.
RLS : admins de l'organisation. Les observateurs (propriétaires) voient les séjours, jamais la connexion ni les e-mails.

## 7. Onglet Connections
Une carte par connexion : **Telegram** (déplacé ici), **Gmail** (Connect / Disconnect, adresse, dernière relève,
« Check now », 20 derniers e-mails avec leur type et le séjour créé), plus tard WhatsApp et la banque.

## 8. Sply
Le brief annonce les nouvelles réservations (« New booking: Beck, 30 Oct → 6 Nov, €425.15 »), les annulations,
les versements, et les e-mails non reconnus. Outil `list_bookings` facultatif.

## Étapes
1. **V1 (codée)** : connexion Gmail via Composio, relève quotidienne (cron 22:00 UTC, avant le brief) et « Check now »,
   barrière, lecteurs `confirmed`, `payout`, `canceled`, `altered`, message du support, calcul du séjour (taux réel,
   nuit ajoutée, annulation), annonce → villa, onglet Connections avec journal. Code : `lib/stays/airbnb-email.ts`,
   `lib/stays/email-stay.ts`, `lib/mail/` ; tests sur copies anonymisées (`lib/stays/fixtures/airbnb-email/`).
   Bouton **Cancel stay / Keep** sur les alertes du support (dans Connections ; le brief viendra en V2).
   **Essai réussi le 31/10/2026** dans le bac à sable « Casa ONBA » (boîte de la villa, 170 e-mails sur 120 jours) :
   Abdullah payé au rupiah près, Beck et David réservés (taux estimé), Emil créé puis annulé via l'alerte du support.
   Corrigé pendant l'essai : versements sans Payout ID (avant sept. 2026), second modèle de modification acceptée
   (`reservation/alteration/AlterationAcceptedTemplate`), alerte du support sur une réservation pas encore créée ;
   chaque relève relit les e-mails non reconnus ou de modèle inconnu.
   Migration appliquée sur Supabase le 31/10/2026. Reste : variables Composio sur Vercel, commit et mise en ligne.
2. **V2** : brief de Sply (nouvelles réservations, alerte support avec Cancel stay / Keep, séjour sans versement 3 jours
   après l'arrivée), lien des versements avec Bank, `listing_villas` réutilisé par l'import CSV, module activable.
3. **V3** : secours IA via Review, adresse de transfert pour les boîtes hors Gmail, propre app Google vérifiée (lecture seule, nom Splyce).

## À fournir par Pierre avant de coder
- ~~E-mails `.eml`~~ : 15 reçus le 30/10/2026 (`private/`), dont une annulation, une modification de bout en bout
  (demande, acceptation, versement du complément) et une annulation par l'hôte via le support. Tous les cas connus sont couverts.
  Les tests du dépôt utiliseront des copies anonymisées (noms et codes changés).
- Un compte Composio (composio.dev) au nom de Splyce, sa **clé API** rangée dans `app/.env.local` et sur Vercel
  (`COMPOSIO_API_KEY`), et l'**auth config Gmail** en connexion gérée (« Composio managed »). Pas de projet Google Cloud pour le pilote.
