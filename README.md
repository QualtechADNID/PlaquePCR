# Génération de plans de plaques PCR

## Contexte

La demande : générer des plans de plaques PCR directement depuis les feuilles de travail **LabVantage** (LV), sans créer de plaques virtuelles dans LV.  
Contraintes : pas de bouton directement dans LV (passage par une page externe). Les codes de plaques ne sont pas gérés par cette solution : une solution de traçabilité doit être mise en place séparément.

---

## Procédure

1. **Préparer la feuille de travail dans LabVantage**
   - Créer la feuille de travail.
   - Vérifier que les champs **PRE-PCR-MON**, **Amorces** et **Programme PCR** sont renseignés.
   - Sélectionner la vue *« Échantillon par paramètre – ADNID »*.
   - Vérifier que les limitations de la feuille de travail ne sont pas atteintes.

   ⚠️ **Alerte capacité**  
   Si le chiffre affiché est **en rouge**, cela signifie qu’il y a **trop d’échantillons**.  
   → Réduire le nombre et **répéter la procédure par lots**.

2. **Exporter la feuille de travail**
   - Exporter au **format Excel**.

3. **Accéder à l’outil**
   - Ouvrir : `http://adnid-bioinfo/pcr`.

4. **Sélectionner le modèle et charger le fichier**
   - Sélectionner le **modèle**.
   - **Charger** le fichier Excel exporté.

5. **Configurer la position (si nécessaire)**
   - Si la **position est modifiée**, les plaques seront générées **à l’endroit indiqué**.  
   - ⚠️ Cette modification change la **valeur par défaut** lors de la prochaine utilisation du modèle.

6. **Générer et récupérer le plan**
   - Cliquer sur **« Générer la plaque PCR »**.
   - **Télécharger** le plan généré.

---

## Ajouter un modèle personnalisé

1. **Préparer le fichier Excel**
   - La feuille principale doit s’appeler **« Feuil1 »**.
   - Laisser un espace de **16 colonnes × N lignes vides** à l’endroit prévu pour les plaques.

2. **Enregistrer le modèle**
   - Compléter le **formulaire** dans l’interface.

3. **Réutiliser**
   - Le modèle sera disponible pour les **plans futurs**.

---

## Notes

- « Modèle » = *template* (équivalent français).
- La gestion et la mise à jour des modèles sont sous la **responsabilité des utilisateurs**.
