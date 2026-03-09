/**
 * selection.js — Gestion de la sélection multiple de puits
 *
 * Dépendances : state.js, utils.js
 */

import { currentLayout, activeProgIdx } from './state.js';
import { ROWS, COLS, wellKey } from './utils.js';

/** Set de clés "progName\x00plateNbr\x00wellKey" des puits sélectionnés */
export const selectedWells = new Set();

/** Dernière clé sélectionnée (pour Shift+clic) */
export let lastSelectedKey = null;
export function setLastSelectedKey(val) { lastSelectedKey = val; }

/** Construit la clé composite d'un puits */
export function selKey(progName, plateNbr, wKey) {
  return `${progName}\x00${plateNbr}\x00${wKey}`;
}

/** Décompose une clé composite */
export function parseSelKey(k) {
  const parts = k.split('\x00');
  return { progName: parts[0], plateNbr: parseInt(parts[1]), wKey: parts[2] };
}

/** Vide la sélection et retire la classe CSS correspondante */
export function clearSelection() {
  selectedWells.clear();
  lastSelectedKey = null;
  document.querySelectorAll('.well.selected').forEach(el => el.classList.remove('selected'));
  updateSelectionBar();
}

/** Met à jour la barre de statut de sélection */
export function updateSelectionBar() {
  const bar = document.getElementById('selection-bar');
  const count = document.getElementById('selection-count');
  if (selectedWells.size > 0) {
    bar.classList.remove('hidden');
    count.textContent = `${selectedWells.size} puits sélectionné${selectedWells.size > 1 ? 's' : ''}`;
  } else {
    bar.classList.add('hidden');
  }
}

/**
 * Retourne toutes les clés de puits occupés du programme actif,
 * dans l'ordre de la grille (colonne par colonne, plaque par plaque).
 */
export function allOccupiedKeysInOrder(progName) {
  const prog = currentLayout.programmes.find(p => p.name === progName);
  if (!prog) return [];
  const keys = [];
  prog.plates.forEach(plate => {
    COLS.forEach(c => {
      ROWS.forEach(r => {
        const wk = wellKey(r, c);
        if (plate.wells[wk]) keys.push(selKey(progName, plate.plate_nbr, wk));
      });
    });
  });
  return keys;
}

/**
 * Gestionnaire de clic sur un puits (sélection simple, Ctrl, Shift).
 * @param {MouseEvent} e
 * @param {string} progName
 * @param {number} plateNbr
 * @param {string} wKey
 * @param {object|null} wellData
 */
export function handleWellClick(e, progName, plateNbr, wKey, wellData) {
  if (!wellData) {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) clearSelection();
    return;
  }

  const k = selKey(progName, plateNbr, wKey);

  if (e.shiftKey && lastSelectedKey) {
    const allKeys = allOccupiedKeysInOrder(progName);
    const idxLast = allKeys.indexOf(lastSelectedKey);
    const idxCurr = allKeys.indexOf(k);
    if (idxLast !== -1 && idxCurr !== -1) {
      const [from, to] = idxLast < idxCurr ? [idxLast, idxCurr] : [idxCurr, idxLast];
      for (let i = from; i <= to; i++) selectedWells.add(allKeys[i]);
    } else {
      selectedWells.add(k);
    }
  } else if (e.ctrlKey || e.metaKey) {
    if (selectedWells.has(k)) {
      selectedWells.delete(k);
    } else {
      selectedWells.add(k);
      lastSelectedKey = k;
    }
  } else {
    if (selectedWells.size === 1 && selectedWells.has(k)) {
      selectedWells.clear();
      lastSelectedKey = null;
    } else {
      selectedWells.clear();
      selectedWells.add(k);
      lastSelectedKey = k;
    }
  }

  // Synchroniser les classes CSS sans re-render complet
  document.querySelectorAll('.well[data-prog]').forEach(el => {
    const ek = selKey(el.dataset.prog, parseInt(el.dataset.plate), el.dataset.well);
    if (selectedWells.has(ek)) {
      el.classList.add('selected');
    } else {
      el.classList.remove('selected');
    }
  });
  updateSelectionBar();
}
