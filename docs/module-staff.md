# Module Staff (équipe, travail, paie)

Conception validée le 27/10/2026 ; **V1 livrée le 27/10/2026** (page Team, outils Sply, paie dans le brief). Module activable par organisation (`module_activations`, clé `payroll`).

## Principes (décidés avec Pierre)
- **Pierre saisit** le travail fait (dans l'app ou en le dictant à Sply). Le staff ne se connecte pas (étape ultérieure possible).
- **Chaque personne a sa façon de travailler, paramétrée dans sa fiche** ; Splyce calcule la paie à partir du journal.
- La paie devient des **dépenses** (catégorie du staff, ex. « Staff Salaries ») : elle compte dans la performance du mois.

## 1. Fiche staff
Nom, rôle (housekeeper, manager, jardinier, piscine…), **salarié ou freelance**, villa par défaut, actif, téléphone (facultatif), notes.
**Mode de paie** (un seul par personne) :

| Mode | Paramètres | Calcul du mois |
|---|---|---|
| **Mensuel** | montant fixe ; base facultative (N passages ou N heures par semaine) ; tarif extra (par défaut fixe ÷ base du mois) | fixe + (réalisé − base du mois) × tarif extra, si positif |
| **À l'heure** | taux horaire | heures du mois × taux |
| **À la prestation** | tarif par prestation | prestations du mois × tarif |

**Période de paie** : du lendemain du jour de paie précédent au jour de paie (payé le 25 → la paie de novembre couvre
du 26 octobre au 25 novembre). Base de la période = base par semaine × jours de la période ÷ 7, arrondie. Sans base : fixe seul ; les extras se saisissent à part
(« extra 150k pour Kadek ») et s'ajoutent.
**Jour de paie** : par défaut le 25 (réglable par personne).

## 2. Journal du travail
Une ligne = date, personne, villa, **heures** ou **nombre de prestations/passages** (selon le mode), tâche (ménage complet,
piscine, check-in…), note. Sources : app (formulaire + vue calendrier du mois) et Sply (« Delia a fait le ménage aujourd'hui »,
« Kadek 3 h de jardin hier »). Vue **« Qui a bossé »** : calendrier du mois par personne et par villa, totaux.

## 3. Paie du mois
- **25 au matin** : le brief de Sply annonce la paie du mois (par personne, détail du calcul, total) et propose de la préparer.
- **« Oui »** → une **fiche de paie** par personne (brouillon : montant, détail, période). Corrigeable avant validation.
- **Payé** (dans l'app ou « payé » / preuve de virement à Sply) → la dépense est créée dans la catégorie du staff, la preuve
  en justificatif ; la fiche passe à « payée ».
- Toujours pas payé le 27 → Sply relance.

## 4. Sply (outils)
`list_staff`, `add_staff` / `update_staff` (paramétrage par la conversation), `log_work`, `team_month` (qui a bossé, totaux),
`prepare_payroll` (calcule et crée les brouillons), `mark_paid` (crée les dépenses, accepte une preuve en pièce jointe).
Le brief inclut la paie du 25 au 27 tant qu'elle n'est pas faite.

## 5. Données
- `staff` : organisation, nom, rôle, type, mode, montants/taux, base (unité + par semaine), tarif extra, jour de paie, villa, actif.
- `work_logs` : staff, villa, date, heures, prestations, tâche, note, auteur.
- `pay_runs` : staff, mois, statut (brouillon / validée / payée), montant, détail (jsonb), écriture liée, date de paiement.
RLS : admins et staff de l'organisation (rôle Splyce « staff ») lisent et écrivent ; observateurs (propriétaires) ne voient pas
les salaires individuels, seulement le total dans les dépenses.

## Plus tard
Avances du staff (achats payés de leur poche, reçus internes), bulletins PDF, déclaration par le staff lui-même, export.
