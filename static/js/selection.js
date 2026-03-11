/**
 * selection.js — Gestion de la sélection multiple de puits
 *
 * Dépendances : state.js, utils.js
 */

import { currentLayout } from './state.js';
import { ROWS, COLS, wellKey } from './utils.js';

// ── Sélection puits de plaque ─────────────────────────────────────────────────

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

// ── Sélection puits non assignés ─────────────────────────────────────────────

/** Set d'indices (dans _unplacedItems) des puits non assignés sélectionnés */
export const selectedUnplaced = new Set();

/** Dernier index sélectionné dans la liste unplaced (pour Shift+clic) */
let lastUnplacedIdx = null;

// ── Sélection unifiée ─────────────────────────────────────────────────────────

/** Vide la sélection complète (plaque + non assignés) et retire les classes CSS */
export function clearSelection() {
  selectedWells.clear();
  lastSelectedKey = null;
  selectedUnplaced.clear();
  lastUnplacedIdx = null;
  document.querySelectorAll('.well.selected').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.unplaced-item.selected').forEach(el => el.classList.remove('selected'));
  updateSelectionBar();
}

/** Total des items sélectionnés (toutes catégories) */
export function totalSelected() {
  return selectedWells.size + selectedUnplaced.size;
}

/** Met à jour la barre de statut de sélection */
export function updateSelectionBar() {
  const bar = document.getElementById('selection-bar');
  const count = document.getElementById('selection-count');
  const total = totalSelected();
  if (total > 0) {
    bar.classList.remove('hidden');
    count.textContent = `${total} élément${total > 1 ? 's' : ''} sélectionné${total > 1 ? 's' : ''}`;
  } else {
    bar.classList.add('hidden');
  }
}

/**
 * Retourne toutes les clés de puits occupés d'un programme,
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
 * Synchronise les classes CSS .selected sur tous les puits du DOM.
 */
export function syncSelectionDOM() {
  document.querySelectorAll('.well[data-prog]').forEach(el => {
    const ek = selKey(el.dataset.prog, parseInt(el.dataset.plate), el.dataset.well);
    el.classList.toggle('selected', selectedWells.has(ek));
  });
  updateSelectionBar();
}

/**
 * Synchronise les classes CSS .selected sur les items non assignés du DOM.
 */
export function syncUnplacedSelectionDOM() {
  document.querySelectorAll('.unplaced-item[data-idx]').forEach(el => {
    el.classList.toggle('selected', selectedUnplaced.has(parseInt(el.dataset.idx)));
  });
  updateSelectionBar();
}

// ── Sélection ligne / colonne ─────────────────────────────────────────────────

/**
 * Sélectionne tous les puits occupés d'une ligne (ex: 'A') dans la plaque donnée.
 * Ctrl/Meta → ajoute à la sélection existante, sinon remplace.
 */
export function selectRow(progName, plateNbr, row, additive) {
  const prog = currentLayout.programmes.find(p => p.name === progName);
  const plate = prog?.plates.find(p => p.plate_nbr === plateNbr);
  if (!plate) return;
  if (!additive) selectedWells.clear();
  COLS.forEach(col => {
    const wk = wellKey(row, col);
    if (plate.wells[wk]) selectedWells.add(selKey(progName, plateNbr, wk));
  });
  syncSelectionDOM();
}

/**
 * Sélectionne tous les puits occupés d'une colonne (ex: 1) dans la plaque donnée.
 * Ctrl/Meta → ajoute à la sélection existante, sinon remplace.
 */
export function selectCol(progName, plateNbr, col, additive) {
  const prog = currentLayout.programmes.find(p => p.name === progName);
  const plate = prog?.plates.find(p => p.plate_nbr === plateNbr);
  if (!plate) return;
  if (!additive) selectedWells.clear();
  ROWS.forEach(row => {
    const wk = wellKey(row, col);
    if (plate.wells[wk]) selectedWells.add(selKey(progName, plateNbr, wk));
  });
  syncSelectionDOM();
}

// ── Sélection des items non assignés ─────────────────────────────────────────

/**
 * Gère le clic sur un item non assigné.
 * @param {MouseEvent} e
 * @param {number} idx  Index dans _unplacedItems
 * @param {number} total  Longueur totale de _unplacedItems
 */
export function handleUnplacedClick(e, idx, total) {
  e.stopPropagation(); // éviter de déclencher le clear sur le conteneur

  if (e.shiftKey && lastUnplacedIdx !== null) {
    const from = Math.min(lastUnplacedIdx, idx);
    const to   = Math.max(lastUnplacedIdx, idx);
    for (let i = from; i <= to; i++) selectedUnplaced.add(i);
  } else if (e.ctrlKey || e.metaKey) {
    if (selectedUnplaced.has(idx)) {
      selectedUnplaced.delete(idx);
    } else {
      selectedUnplaced.add(idx);
      lastUnplacedIdx = idx;
    }
  } else {
    if (selectedUnplaced.size === 1 && selectedUnplaced.has(idx)) {
      selectedUnplaced.clear();
      lastUnplacedIdx = null;
    } else {
      selectedUnplaced.clear();
      selectedUnplaced.add(idx);
      lastUnplacedIdx = idx;
    }
  }

  syncUnplacedSelectionDOM();
}

// ── Drag-select (lasso rectangulaire sur la grille) ───────────────────────────

let _dragSelectActive  = false;
let _dragSelectStartKey = null;
let _dragSelectProgName = null;
let _dragSelectPlateNbr = null;
let _dragSelectBase     = null;

export function startDragSelect(progName, plateNbr, wKey, additive) {
  _dragSelectActive  = true;
  _dragSelectStartKey = wKey;
  _dragSelectProgName = progName;
  _dragSelectPlateNbr = plateNbr;
  _dragSelectBase = additive ? new Set(selectedWells) : new Set();
  if (!additive) selectedWells.clear();
  selectedWells.add(selKey(progName, plateNbr, wKey));
  syncSelectionDOM();
}

export function updateDragSelect(progName, plateNbr, wKey) {
  if (!_dragSelectActive) return;
  if (progName !== _dragSelectProgName || plateNbr !== _dragSelectPlateNbr) return;

  const startRow = _dragSelectStartKey[0];
  const startCol = parseInt(_dragSelectStartKey.slice(1), 10);
  const currRow  = wKey[0];
  const currCol  = parseInt(wKey.slice(1), 10);

  const rIdxStart = ROWS.indexOf(startRow);
  const rIdxCurr  = ROWS.indexOf(currRow);
  const [rFrom, rTo] = rIdxStart <= rIdxCurr ? [rIdxStart, rIdxCurr] : [rIdxCurr, rIdxStart];
  const [cFrom, cTo] = startCol <= currCol   ? [startCol, currCol]   : [currCol, startCol];

  const prog  = currentLayout.programmes.find(p => p.name === _dragSelectProgName);
  const plate = prog?.plates.find(p => p.plate_nbr === _dragSelectPlateNbr);
  if (!plate) return;

  selectedWells.clear();
  _dragSelectBase.forEach(k => selectedWells.add(k));

  for (let ri = rFrom; ri <= rTo; ri++) {
    for (let ci = cFrom; ci <= cTo; ci++) {
      const wk = wellKey(ROWS[ri], ci);
      if (plate.wells[wk]) {
        selectedWells.add(selKey(_dragSelectProgName, _dragSelectPlateNbr, wk));
      }
    }
  }
  syncSelectionDOM();
}

export function endDragSelect() {
  _dragSelectActive   = false;
  _dragSelectStartKey = null;
  _dragSelectBase     = null;
}

/**
 * Sélectionne tous les puits occupés d'une plaque donnée.
 * Remplace la sélection existante (pas d'additive ici, comportement standard Ctrl+A).
 */
export function selectAllOnPlate(progName, plateNbr) {
  const prog = currentLayout.programmes.find(p => p.name === progName);
  const plate = prog?.plates.find(p => p.plate_nbr === plateNbr);
  if (!plate) return;
  selectedWells.clear();
  ROWS.forEach(row => {
    COLS.forEach(col => {
      const wk = wellKey(row, col);
      if (plate.wells[wk]) selectedWells.add(selKey(progName, plateNbr, wk));
    });
  });
  syncSelectionDOM();
}

export function isDragSelectActive() { return _dragSelectActive; }

// ── Gestionnaire de clic sur un puits de plaque ───────────────────────────────

/**
 * Clic simple, Ctrl+clic, Shift+clic sur un puits de plaque.
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

  syncSelectionDOM();
}
