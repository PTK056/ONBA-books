# Sécurité

Bilan du 26/10/2026 (vérifié dans le code et en ligne ; pas un audit professionnel).

## Ce qui est en place
- **Fichiers** : bucket `evidence` privé ; lecture réservée aux admins/staff de l'organisation (chemin `<org>/…` imposé
  par la base), les observateurs ne voient que leurs villas. Testé : sans compte, liste vide et URL publique refusée.
- **Données** : RLS sur toutes les tables, isolation entre organisations (tests `supabase/tests/*.sql`).
- **Clés** : le navigateur ne reçoit que l'URL Supabase et la clé publishable (publiques par conception) ; aucun secret
  dans le bundle ni dans l'historique git ; jetons des chats chiffrés (AES-GCM) en base.
- **Next.js** à jour des avis de sécurité (16.4.2, 23/10/2026).

## À faire — avant d'inviter d'autres utilisateurs
1. ~~Protéger la facture IA~~ : fait (27/10/2026), voir « Fait ».
2. ~~En-têtes de sécurité et page de consentement OAuth durcie~~ : fait (27/10/2026), voir « Fait ».
3. ~~Captcha Turnstile~~ : fait (27/10/2026), voir « Fait ».

## À faire — ensuite
4. **MFA** (application d'authentification) pour les admins ; TOTP déjà activé côté Supabase, écran à faire.
5. **Liens de partage** : 7 jours et non révocables → plus courts, ou servis par une route qui vérifie un jeton révocable.
6. **Clés Supabase** : passer la fonction `read-receipts` de `SUPABASE_ANON_KEY` (ancienne clé) aux nouvelles clés,
   puis désactiver les anciennes clés anon / service_role.
7. **Variables Vercel** marquées *Sensitive* ; copie locale `~/.config/onbabooks/vercel.env` à garder chiffrée
   (FileVault) ou à ranger dans un gestionnaire de mots de passe.
8. **Politique de confidentialité** : sous-traitants (Supabase Tokyo, Vercel, Anthropic, OpenAI, Telegram, Resend).

## Fait
- **Captcha Turnstile** (27/10/2026) : widget Cloudflare « Splyce » (mode Managed, `app.splyce.me` + `localhost`),
  clé de site dans Vercel (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`), clé secrète dans Supabase (Attack Protection). Vérifié :
  une demande de code sans jeton est refusée (`captcha_failed`), une vraie connexion passe. Invisible pour la plupart des gens.
  Pour le désactiver : d'abord Supabase, ensuite seulement retirer la variable Vercel.
- **Quotas IA par organisation** (27/10/2026, tests `supabase/tests/ai_quotas.sql`) : par mois civil, 100 reçus lus,
  300 messages à l'agent, 60 minutes de vocal par défaut. Au-delà, les reçus restent en attente (« Read now » plus tard,
  ou saisie à la main), l'agent répond que l'enveloppe du mois est épuisée. Un plafond différent par organisation va dans
  `private.ai_limits` (éditeur SQL Supabase uniquement ; un admin ne peut pas relever le sien) ; consommation dans
  `private.ai_usage`. Un compte crée au plus 3 organisations (chacune a son quota). Le brief du matin (Haiku) n'est pas compté.
- **En-têtes** (27/10/2026) : `frame-ancestors 'none'` + `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy` (`next.config.ts`).
- **Consentement OAuth** (27/10/2026) : la page affiche l'adresse qui reçoit l'accès ; avertissement si ce n'est ni
  Splyce ni Claude (`claude.ai`, `claude.com`), ou si c'est une appli locale ; refus si l'adresse n'est pas en https.
  Le nom de l'appli n'est jamais pris pour preuve (n'importe qui peut s'appeler « Claude » par DCR).
- **Journal des téléchargements** (26/10/2026, testé) : ZIP, liens de partage et bouton Download notés (qui, quand, quoi)
  dans `download_log` ; lecture admins seulement dans **Documents → Activity** ; aucune entrée modifiable ni effaçable.
- **Pages protégées** (vérifié le 26/10/2026) : sans session, toutes les pages de l'app renvoient vers la connexion ;
  un compte d'une autre organisation ne voit jamais les fiches d'une autre (code + RLS). Exceptions voulues : liens de
  partage (7 jours) et adresses d'aperçu signées (1 heure).

## Journal des téléchargements — limite
Limite assumée : il trace ce qui passe par l'app (ZIP, liens de partage, bouton Download) ;
un membre technique pourrait encore lire les fichiers directement par l'API Supabase avec sa session. Le bloquer
demanderait de servir tous les fichiers par une route de l'app (à envisager si un client l'exige).
