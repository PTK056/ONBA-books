# Mise en ligne (étape 1)

**État au 20/10/2026** : l'app est en ligne sur https://onba-books.vercel.app (Vercel Hobby, dépôt privé
`PTK056/ONBA-books`, déploiement à chaque push sur `main`). Supabase connaît cette adresse (site et
retours autorisés). Pierre s'y connecte depuis son téléphone. Clé Resend rangée dans
`~/.config/onbabooks/resend_key`. **Reste** : le domaine, puis Resend + SMTP + modèle d'e-mail (points 1, 2 et 6).
Le plan gratuit de Supabase **refuse de changer les modèles d'e-mail** sans SMTP personnalisé : l'e-mail
ONBA Books (lien + code) attend donc le domaine. Les blocs sont commentés dans `config.toml`.
Pour `config push` : relire le diff, ne pousser que ce qu'on veut changer (le CLI compare aussi stockage, MFA, etc.).

But : l'app sur une vraie adresse (`app.onbabooks.com`, en attendant `onba-books.vercel.app`), utilisable sur téléphone, avec des e-mails
de connexion envoyés à n'importe qui (aujourd'hui l'envoi Supabase par défaut ne part qu'aux membres
de l'équipe Supabase, quelques e-mails par heure).

Déjà prêt dans le code (branche `core-schema`) :
- E-mail de connexion ONBA Books (`app/supabase/templates/sign_in.html`) : un lien `token_hash` qui
  marche dans n'importe quel navigateur (l'ancien lien `?code=` exigeait le navigateur qui l'avait
  demandé, ce qui cassait souvent sur téléphone) **et** un code à 6 chiffres.
- Écran de connexion en deux temps : e-mail, puis « ouvrez le lien ou tapez le code ».
- Bloc SMTP Resend prêt à décommenter dans `app/supabase/config.toml`.
- Les pages `/dev/*` renvoient 404 en production.

## Ce que Pierre fait lui-même (comptes, achats, DNS)

1. **Domaine `onbabooks.com`** : l'acheter (Cloudflare Registrar ou Namecheap, ~10 $/an). Libre au 07/10, à revérifier.
2. **Resend** (resend.com, gratuit jusqu'à 3 000 e-mails/mois, 100/jour) : créer le compte, ajouter le
   domaine `onbabooks.com`, poser chez le registrar les enregistrements DNS affichés (SPF, DKIM, MX de retour),
   attendre « Verified », puis créer une clé API « Sending access ».
   La ranger dans `~/.config/onbabooks/resend_key` (hors dépôt, comme la clé Anthropic).
3. **GitHub** : créer un dépôt **privé** vide `onbabooks` (sans README). Claude y pousse le code ensuite.
4. **Vercel** : créer le compte avec GitHub, importer le dépôt, **Root Directory = `app`**, variables
   `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (mêmes valeurs que `app/.env.local`),
   puis ajouter le domaine `app.onbabooks.com` (Vercel donne l'enregistrement CNAME à poser).
   Attention : le plan gratuit Hobby est réservé à l'usage non commercial ; passer en **Pro (20 $/mois)**
   avant le premier client payant.

## Ce que Claude fait ensuite

5. Pousser `core-schema` sur GitHub (Vercel déploie chaque push ; aperçu par branche).
6. Supabase, dans `config.toml` : `site_url = "https://app.onbabooks.com"`, URLs de retour autorisées
   (production, aperçus Vercel, localhost), bloc SMTP décommenté, plafond d'envoi relevé.
   Puis `RESEND_API_KEY=… npx supabase config push` : le CLI montre la différence avec le projet en ligne,
   on la relit avant de confirmer.
7. Tester sur téléphone : demande de lien, ouverture depuis l'app Mail, saisie du code, création d'un compte neuf.
