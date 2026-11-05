# Module Sply Accountant (rapprochement bancaire par l'assistant)

Conception proposée le 04/11/2026 ; **choix validés par Pierre le 04/11/2026** (voir § Décisions). **V1 codée le 05/11/2026** (§ Livré en V1), à déployer. S'appuie sur les outils banque livrés le même jour
(`Splyce — Bank MCP tools spec.md`, migration `bank_agent`).

## But

Quand un relevé arrive, Sply le rapproche : chaque ligne « at the bank, not in your books » finit ajoutée, liée ou marquée
personnelle, correctement. Sply demande ce qu'il ne sait pas, réclame les justificatifs manquants, et apprend des réponses
pour ne plus redemander. Pierre ne fait plus que valider.

## Décisions (Pierre, 04/11/2026)

- **Dans Splyce**, pas dans la Console Claude.
- **Validation d'abord sur Telegram**, avec des boutons sous chaque proposition (OK / Decline) et un « OK all sure ones ».
  L'onglet Bank montre les mêmes propositions, pour qui préfère l'app.
- **Application automatique autorisée quand c'est certain.** « Certain » ne dépend pas de l'avis du modèle : ce sont des
  critères vérifiés par le code (§ C bis), et le modèle doit être d'accord en plus.
- **Sply Accountant parle comme un membre de l'équipe**, distinct de Sply (§ E bis).

## Principes

1. **Une fonction du produit, pas un agent personnel.** Chaque organisation cliente l'a. Ses règles (bénéficiaires connus,
   comptes du propriétaire, autonomie) sont des réglages en base, jamais un prompt écrit pour Casa ONBA.
2. **Le déterministe d'abord, l'IA pour le reste.** L'auto-match, la mémoire des bénéficiaires et les frais bancaires
   traitent déjà les cas évidents, gratuitement. L'IA ne voit que ce qui reste.
3. **L'IA propose, le code applique.** Sply écrit des *propositions*, jamais directement dans les comptes. Accepter une
   proposition appelle les fonctions atomiques déjà livrées (`bank_line_book`, `bank_line_link`…), sans nouvel appel à l'IA :
   pas de « mode apply » à faire tourner, pas de risque qu'il applique autre chose que ce qui a été validé.
4. **Jamais deviner.** Un doute devient une question, posée dans l'app et sur Telegram.
5. **L'autonomie se gagne.** Par défaut : propositions seulement. Réglage par organisation : appliquer seul les propositions
   sûres, une fois que deux mois de suite n'ont demandé aucune correction.

## Pourquoi pas un agent dans la Console Claude

| | Agent dans la Console (Managed Agents) | Dans Splyce (comme le chat Sply) |
| --- | --- | --- |
| Clients | Un agent configuré à la main par compte ; règles de Casa ONBA dans le prompt | Toutes les organisations ; règles en base |
| Déclenchement à l'ajout d'un relevé | Splyce doit appeler l'API Anthropic pour lancer une session : du code de toute façon | Directement dans `addStatement` |
| Accès aux données | MCP + jetons OAuth de chaque utilisateur stockés dans un coffre Anthropic, rafraîchis | Les outils tournent dans Splyce avec la session de l'utilisateur (RLS) |
| Validation | Confirmations d'outils de la Console, faites pour un développeur | Dans l'onglet Bank et sur Telegram, là où Pierre travaille |
| Coût | Tokens + temps de session (0,08 $/h) + bac à sable Python inutile ici | Tokens seulement ; compté dans le quota IA de l'organisation |
| Ce qui existe déjà | Rien | Boucle d'agent (`lib/agent/run.ts`), outils partagés, quotas, Telegram, brief |

La Console reste utile pour **essayer le prompt** sans coder. Encore plus simple : un projet claude.ai avec le connecteur
Onba books déjà branché, en lecture seule (mode propositions) sur avril 2026. Mais l'évaluation sur l'historique
(§ Évaluation) dit plus, et plus vite.

## Parcours

1. **Pierre ajoute un relevé** dans l'onglet Bank (plus tard : en l'envoyant à Sply sur Telegram ou par e-mail).
2. Splyce le lit, l'enregistre, fait l'auto-match. Sply Accountant démarre en arrière-plan sur les lignes restantes du relevé.
3. **Message Telegram** quand c'est prêt : « Danamon octobre : 42 lignes. 30 déjà rapprochées, 9 propositions sûres,
   3 questions. » Les questions suivent, numérotées, une ligne chacune, avec le lien vers l'onglet Bank.
4. **Onglet Bank** : chaque ligne restante porte la proposition de Sply (action, villa, catégorie, pourquoi en une ligne),
   avec Accepter / Modifier / Rejeter, et un bouton « Accept the 9 sure ones ».
5. **Questions** : Pierre répond dans l'app ou sur Telegram (« ok tout », « ok sauf 3 », « 5 = Pool & garden »,
   « raja niaga c'est le fournisseur de gaz »). Sply transforme la réponse en décisions, que le code applique.
6. **Justificatifs** : après application, chaque dépense au-dessus du seuil de l'organisation sans justificatif devient une
   demande. Elle apparaît dans « Receipts to bring », dans le brief du matin et dans un message Sply. Une photo envoyée sur
   Telegram est rattachée à la bonne entrée (`attach_evidence`). Plus tard : rapprocher un reçu en attente de revue d'une
   ligne bancaire.
7. **Apprentissage** : chaque décision nourrit la mémoire des bénéficiaires (déjà en place). Une réponse du type
   « toujours » devient une règle appliquée à l'import, pour que la ligne n'atteigne plus jamais l'IA.

## Composants

### A. Propositions (table `bank_proposals`)
Une proposition ouverte au plus par ligne : `line_id`, `action` (`add` | `link` | `personal` | `charges` | `ask`), `villa_id`,
`category_id`, `description`, `transaction_id` ou `stay_ids`, `personal_reason`, `confidence` (`high` | `medium` | `low`),
`why`, `question`, `status` (`pending` | `accepted` | `rejected` | `applied` | `stale`), `run_id`, et qui a décidé, quand.
Admins seulement (RLS), comme le reste du module. Une proposition dont la ligne a été traitée entre-temps devient `stale`.

### B. Le passage de Sply (`runAccountant`)
- **Pré-calcul déterministe** pour chaque ligne : réservation habituelle du bénéficiaire, entrées candidates avec leur
  score (`lib/bank/suggest.ts`), séjours et paiements Airbnb annoncés, lignes de même référence, frais bancaires, comptes du
  propriétaire.
- **Un appel à Claude** (Messages API, sortie JSON structurée) avec toutes les lignes et leurs candidats, par paquets
  d'environ 40, plus quelques outils de lecture pour les cas ambigus (`find_transactions`, `suggest_bank_links` avec un
  texte). La boucle est courte (6 étapes au plus) et n'a **aucun outil d'écriture** : il ne peut qu'écrire des propositions.
- **Déclencheurs** : fin de `addStatement` (en arrière-plan, après la réponse), bouton « Ask Sply » dans l'onglet Bank,
  commande `/bank` sur Telegram.
- **Modèle** : variable d'environnement. Sonnet 5.5 pour commencer comme tu le proposais, puis Haiku 5.5 si l'évaluation
  donne les mêmes décisions. Ordre de grandeur : quelques centimes par relevé.
- **Quota** : un nouveau type `bank_review` dans `ai_quotas` (un relevé = une unité).

### C. Appliquer (`applyProposal`)
Code pur, sans IA : selon l'action, `bookLine`, `linkEntry` (montant identique exigé, sauf accord explicite), `linkStays`,
`markLinePersonal` ou `bookStatementCharges`. La trace est `handled_via = 'agent'`, avec le « pourquoi » en note. Si la ligne
a été traitée entre-temps, la proposition passe en `stale` et rien n'est écrit.

### C bis. Application automatique (« certain »)
Une proposition est appliquée sans clic seulement si l'organisation l'a activé et si l'un de ces cas est vrai, vérifié par
le code :
- une **règle confirmée** par le propriétaire (« toujours ») s'applique à la ligne ;
- le bénéficiaire a été passé **au moins 3 fois de la même façon** (villa, catégorie, sens), sans jamais être corrigé ;
- un **lien** n'a qu'un candidat possible : même montant exact, 3 jours d'écart au plus, nom du bénéficiaire dans la
  description, aucun autre candidat dans la fenêtre.

Le modèle doit aussi la marquer `high`. Jamais automatique : « personnel », un écart de montant, un bénéficiaire vu pour la
première fois, toute suppression. Chaque ligne appliquée seule figure dans le message suivant, avec un bouton **Undo**.

### D. Onglet Bank
La proposition sur chaque ligne, les questions en tête, « Accept the N sure ones », et ce que Sply a fait (déjà en place :
« By the assistant » et la note).

### E. Telegram
Le résumé après chaque passage, puis **une proposition par message, avec ses boutons** (Telegram : clavier en ligne et
`callback_query`, que le webhook ne gère pas encore). OK applique ; Decline la rejette et demande, en une ligne, ce qu'il
fallait faire. Le bouton porte l'id de la proposition. Le webhook vérifie que le chat est bien lié à un admin de
l'organisation avant d'appliquer, et un bouton déjà utilisé ne refait rien. Les réponses en texte libre restent
possibles. Le chat Sply reçoit deux outils : `list_bank_proposals` et `decide_bank_proposals`
(accepter des numéros, corriger un champ, répondre à une question). Le brief du matin rappelle les questions ouvertes et
les justificatifs manquants.

### E bis. Deux voix dans le même chat
Un bot Telegram n'a qu'une identité dans une discussion privée. V1 : le même bot, mais les messages du comptable s'ouvrent
sur sa signature (« 🧾 Sply Accountant ») et ont leur propre ton, sec et chiffré. Le brief du matin reste signé Sply et
renvoie vers le comptable pour les questions banque. Plus tard, si l'envie demeure : un second bot et un groupe « équipe »
(toi, Sply, Sply Accountant). Cela demande d'accepter les groupes (refusés aujourd'hui), de relier un groupe à une
organisation et de vérifier qui a le droit d'appuyer sur les boutons.

### F. Réglages de l'organisation (Settings › Bank)
- **Autonomie** : « Propose only » (défaut) ou « Apply sure ones automatically ».
- **Comptes et noms du propriétaire** : pour reconnaître les virements personnels sans les deviner.
- **Villa par défaut d'un compte** : existe déjà (`bank_accounts.villa_id`).

## Évaluation

Les lignes déjà rapprochées par Pierre forment un jeu de test tout fait. On rejoue Sply sur ces lignes comme si elles
étaient encore ouvertes (lecture seule, sans rien écrire), et on compare avec ce que Pierre a décidé. Lire les vraies
données est autorisé, y écrire non.

À mesurer, par type d'action : la précision des propositions marquées « sûres » (l'objectif est qu'elles ne se trompent
quasiment jamais), et la part de lignes qui finissent en question. C'est ce chiffre qui décide du modèle et du moment où
l'on peut activer l'application automatique.

## Ce qui ne colle pas dans « Sply - Accountant — Agent setup (Claude Console).md »

À corriger si ce document sert pour un prototype :
- **Adresse du MCP** : c'est `https://app.splyce.me/api/mcp`, pas `onba-books.vercel.app`.
- **`expected_status` et `idempotency_key`** n'existent plus : le contrôle est fait dans la base, et un nouvel essai répond
  `already_handled` avec l'état de la ligne.
- **Paiements Airbnb** : pas d'écart à passer en « Platform fees ». Les séjours sont comptés nets des frais, et un paiement
  égale le net.
- **`save_bank_rule`** n'existe pas. La mémoire des bénéficiaires apprend seule à chaque ligne passée en compte
  (`usual_booking`).
- **Frais Wise et frais bancaires** : `book_bank_charges`, un passage en compte par mois, pas ligne par ligne.
- **Justificatifs** : obligatoires au-dessus du seuil de l'organisation, pas pour toutes les dépenses.
- **Prompt** : « Casa ONBA », « Pererenan » et le nom du propriétaire doivent venir de `get_context` et des réglages, pas
  du texte.
- **Python pour les calculs** : inutile, les outils renvoient les montants comparés et les écarts.

## Étapes

- **V1** : propositions, passage de Sply à l'ajout d'un relevé, messages Telegram avec boutons OK / Decline, la même revue
  dans l'onglet Bank, application, signature Sply Accountant, évaluation sur l'historique.
- **V2** : réponses en texte libre, relance des justificatifs, règles « toujours », application automatique « certaine »
  avec Undo.
- **V3** : relevés reçus par Telegram ou e-mail, rapprochement des reçus en attente avec les lignes, plusieurs entrées pour
  une ligne.

## Livré en V1 (05/11/2026)

- Migration `bank_accountant` : `bank_accountant_runs`, `bank_proposals` (lecture seule pour les utilisateurs ; toute écriture
  passe par des fonctions vérifiées), propositions périmées dès que leur ligne est traitée ailleurs, un passage à la fois par
  organisation, délai de 10 min pour une proposition restée « en cours », notes du chat, quota `bank_review` (30 par mois).
- Code : `app/src/lib/bank/accountant/` (dossiers, proposition, application, Telegram), recherche de candidats partagée avec
  le MCP (`lib/bank/candidates.ts`).
- Déclencheurs : fin de l'ajout d'un relevé, bouton « Ask Sply » dans l'onglet Bank, commande `/bank` sur Telegram.
- Telegram : un résumé avec la liste des propositions sûres et « OK all », puis un message avec OK / Decline pour chaque
  proposition à vérifier et chaque question (10 au plus par passage, le reste dans l'onglet Bank). Écart avec le plan :
  les propositions sûres ne reçoivent pas chacune un message, pour ne pas inonder le chat.
- « Sure » est décidé par le code, pas par Claude (le texte bancaire qu'il lit est écrit par l'émetteur du virement) :
  jamais pour « personal », ni pour une ligne en devise ; un ajout seulement s'il suit l'habitude du bénéficiaire (2 fois au
  moins) ; un lien seulement vers le seul candidat au montant exact.
- Pas encore : l'évaluation sur l'historique (à faire avant d'activer l'application automatique), la relance des
  justificatifs, l'application automatique « certaine ».

## Questions ouvertes

Aucune à ce stade : les trois questions ont été tranchées (§ Décisions).
