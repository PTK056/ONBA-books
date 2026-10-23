# Agent WhatsApp (serveur MCP)

Décidé le 23/10/2026. But : envoyer depuis WhatsApp des tickets, des dépenses, des séjours et des pense-bêtes,
qui entrent directement dans ONBA Books ; l'agent relance aussi sur ce qui reste à faire.

## Architecture
WhatsApp → **Owl** (owlagent.me, SaaS d'un ami) → **serveur MCP ONBA Books** → Supabase.

- Serveur MCP = route de l'app : `https://onba-books.vercel.app/api/mcp` (Streamable HTTP, Vercel `hnd1`).
  Générique : marche aussi avec Claude ou ChatGPT. Côté produit : un **module** activable par organisation.
- **Connexion : OAuth 2.1 avec Supabase comme serveur d'autorisation.** Owl obtient une vraie session de
  l'utilisateur : RLS, `auth.uid()`, auteur des écritures et journal d'audit marchent sans clé maître
  (aujourd'hui tout repose sur `auth.uid()`, aucune clé service_role dans l'app).
  Plan B si Owl ne fait pas OAuth : jeton personnel + RPC `security definer` qui revérifient l'appartenance.

## Règles d'écriture (choix de Pierre)
- **Tickets → file Review** (même circuit que Scan receipts : `receipt_batches` / `receipt_items` /
  `evidence`, lecture par la fonction `read-receipts`). Rien n'est compté avant validation dans l'app.
- **Saisies dictées → écrites directement** (`transactions`, `source` à préciser), l'agent répète ce qu'il a
  écrit et propose d'annuler.

## Outils prévus
| Outil | Rôle |
|---|---|
| `get_context` | Villas, catégories, devise, date du jour : à appeler d'abord, pour ne rien inventer. |
| `submit_receipt` | Photo/PDF → file Review ; renvoie ce qui a été lu et les champs douteux. |
| `record_transaction` | Dépense ou recette dictée, écrite directement. |
| `attach_evidence` | Justificatif ajouté à une écriture existante. |
| `record_stay` | Séjour hors Airbnb, depuis une capture de réservation ou une dictée. |
| `add_task` / `complete_task` | Pense-bêtes : paiements à faire, preuves à importer, tâches. **Nouvelle table.** |
| `get_todo` | Ce qui reste à faire : tickets à valider, écritures sans justificatif au-dessus du seuil (`evidence_threshold`), mois non clôturés, tâches et paiements à échéance. Sert au brief du matin d'Owl. |
| `find_transactions` / `month_summary` | Lecture seule. |

## Code (23/10/2026)
- `app/src/app/api/mcp/route.ts` : serveur MCP (`mcp-handler` 2, SDK MCP v2), jeton exigé, `maxDuration` 60 s.
- `app/src/lib/mcp/session.ts` : vérification du jeton Supabase, organisation, villas et catégories ;
  villas et catégories retrouvées par leur nom (casse et accents ignorés), sinon l'erreur liste les choix possibles.
- `app/src/lib/mcp/files.ts` : fichier reçu par lien https ou en base64 ; type vérifié sur les octets ; 10 Mo maximum.
- `app/src/lib/mcp/tools.ts` : les 11 outils (`delete_transaction` en plus, pour annuler une saisie à la main).
- `app/src/app/.well-known/oauth-protected-resource/route.ts` : indique aux clients MCP que le serveur
  d'autorisation est Supabase Auth.
- `app/src/app/oauth/consent/` : page « Allow access » (Supabase y envoie l'utilisateur pendant la connexion).
- `app/supabase/migrations/20261023000000_tasks.sql` (+ test `supabase/tests/tasks.sql`).
- `config.toml` : `[auth.oauth_server] enabled = true`, `allow_dynamic_registration = true`.

Pour brancher un assistant : adresse `https://onba-books.vercel.app/api/mcp`, connexion OAuth (automatique).

## À demander à l'ami (Owl)
1. Owl accepte-t-il un serveur MCP personnalisé ? Avec OAuth, ou seulement un en-tête fixe ?
2. Comment une photo ou un PDF WhatsApp est-il transmis à un outil MCP (lien, base64, rien) ?
3. Les notes vocales sont-elles transcrites avant l'appel de l'outil ?
4. Le brief du matin peut-il appeler un outil MCP (`get_todo`) ?
