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
1. **Protéger la facture IA** : inscription sur invitation, ou quotas par organisation (reçus lus, messages agent, minutes
   de vocal). Aujourd'hui n'importe quel compte consomme les clés Anthropic/OpenAI de Pierre, sans limite.
2. **En-têtes de sécurité** (CSP `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`) et **page de
   consentement OAuth durcie** : afficher l'adresse de destination (redirect URI) et avertir si le client n'est pas connu
   (Claude, bot Telegram). Risque : une fausse appli « Splyce » inscrite par DCR + clic sur « Allow access ».
3. **Captcha** (Cloudflare Turnstile) sur la connexion : le quota d'e-mails (60/h) est commun à tout le projet, un robot
   peut bloquer la connexion de tous.

## À faire — ensuite
4. **MFA** (application d'authentification) pour les admins ; TOTP déjà activé côté Supabase, écran à faire.
5. **Liens de partage** : 7 jours et non révocables → plus courts, ou servis par une route qui vérifie un jeton révocable.
6. **Clés Supabase** : passer la fonction `read-receipts` de `SUPABASE_ANON_KEY` (ancienne clé) aux nouvelles clés,
   puis désactiver les anciennes clés anon / service_role.
7. **Variables Vercel** marquées *Sensitive* ; copie locale `~/.config/onbabooks/vercel.env` à garder chiffrée
   (FileVault) ou à ranger dans un gestionnaire de mots de passe.
8. **Politique de confidentialité** : sous-traitants (Supabase Tokyo, Vercel, Anthropic, OpenAI, Telegram, Resend).

## Fait
- **Journal des téléchargements** (26/10/2026, testé) : ZIP, liens de partage et bouton Download notés (qui, quand, quoi)
  dans `download_log` ; lecture admins seulement dans **Documents → Activity** ; aucune entrée modifiable ni effaçable.
- **Pages protégées** (vérifié le 26/10/2026) : sans session, toutes les pages de l'app renvoient vers la connexion ;
  un compte d'une autre organisation ne voit jamais les fiches d'une autre (code + RLS). Exceptions voulues : liens de
  partage (7 jours) et adresses d'aperçu signées (1 heure).

## Journal des téléchargements — limite
Limite assumée : il trace ce qui passe par l'app (ZIP, liens de partage, bouton Download) ;
un membre technique pourrait encore lire les fichiers directement par l'API Supabase avec sa session. Le bloquer
demanderait de servir tous les fichiers par une route de l'app (à envisager si un client l'exige).
