/**
 * save.js — Sauvegarde du plan de plaque en base de données
 *
 * Dépendances : state.js, utils.js (toast)
 */

import { currentLayout } from './state.js';
import { toast } from './utils.js';

// État courant du plan (muté après chaque sauvegarde)
let currentPlanId   = window.PLAN_ID   ?? null;
let currentPlanName = window.PLAN_NAME ?? '';

// ── Éléments DOM ─────────────────────────────────────────────────────────────
const modal        = document.getElementById('save-modal');
const nameInput    = document.getElementById('save-name-input');
const btnCancel    = document.getElementById('save-modal-cancel');
const btnConfirm   = document.getElementById('save-modal-confirm');
const btnSave      = document.getElementById('btn-save');
const nameBadge    = document.getElementById('plan-name-badge');

// ── Ouvrir / fermer la modale ─────────────────────────────────────────────────
function openSaveModal() {
  nameInput.value = currentPlanName || '';
  modal.classList.remove('hidden');
  nameInput.focus();
  nameInput.select();
}

function closeSaveModal() {
  modal.classList.add('hidden');
}

// ── Sauvegarde effective ──────────────────────────────────────────────────────
async function handleSave() {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }

  btnConfirm.disabled = true;
  btnConfirm.textContent = 'Sauvegarde…';

  try {
    const resp = await fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id:           currentPlanId,
        name:              name,
        layout:            currentLayout,
        template_key:      window.TEMPLATE_KEY,
        position:          window.POSITION,
        original_filename: window.PLAN_NAME || name,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Erreur HTTP ${resp.status}`);
    }

    const result = await resp.json();
    currentPlanId   = result.plan_id;
    currentPlanName = result.name;

    // Mettre à jour le badge de nom dans le header
    if (nameBadge) {
      nameBadge.textContent = currentPlanName;
      nameBadge.classList.remove('hidden');
    } else {
      // Créer le badge s'il n'existait pas (nouveau plan)
      const h1 = document.querySelector('header h1');
      if (h1) {
        const badge = document.createElement('span');
        badge.id = 'plan-name-badge';
        badge.className = 'ml-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-3 py-0.5';
        badge.textContent = currentPlanName;
        h1.insertAdjacentElement('afterend', badge);
      }
    }

    closeSaveModal();
    toast(`Plan « ${currentPlanName} » sauvegardé.`);
  } catch (err) {
    toast(`Erreur : ${err.message}`);
  } finally {
    btnConfirm.disabled = false;
    btnConfirm.textContent = 'Sauvegarder';
  }
}

// ── Branchement des événements ────────────────────────────────────────────────
export function attachSaveButton() {
  btnSave?.addEventListener('click', openSaveModal);
  btnCancel?.addEventListener('click', closeSaveModal);
  btnConfirm?.addEventListener('click', handleSave);

  // Fermer la modale en cliquant sur le fond
  modal?.addEventListener('click', e => {
    if (e.target === modal) closeSaveModal();
  });

  // Valider avec Entrée
  nameInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') closeSaveModal();
  });
}
