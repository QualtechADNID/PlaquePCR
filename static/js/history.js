/**
 * history.js — Pile undo/redo pour toutes les mutations du layout
 *
 * Utilisation :
 *   import { pushState, undo, redo } from './history.js';
 *
 *   // Avant toute mutation du layout :
 *   pushState();
 *   // ... muter currentLayout ...
 *   renderAll();
 *
 * Ctrl+Z → undo()
 * Ctrl+Y / Ctrl+Shift+Z → redo()
 */

import { currentLayout, setCurrentLayout, _unplacedItems, setUnplacedItems } from './state.js';

const MAX_HISTORY = 100;

/** Chaque entrée : { layout: deepCopy, unplaced: deepCopy } */
const undoStack = [];
const redoStack = [];

/** Callback branché depuis main.js après init */
let _renderAll = null;
export function setHistoryRenderCallback(fn) { _renderAll = fn; }

/** Deep-copy JSON d'un objet */
function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Nombre d'étapes undo/redo disponibles */
export function undoCount() { return undoStack.length; }
export function redoCount() { return redoStack.length; }

/** Émet un événement DOM pour que l'UI puisse mettre à jour ses boutons */
function dispatchHistoryChange() {
  document.dispatchEvent(new CustomEvent('history-change', {
    detail: { undoCount: undoStack.length, redoCount: redoStack.length },
  }));
}

/**
 * Capture l'état courant AVANT une mutation.
 * À appeler systématiquement avant toute modification du layout.
 */
export function pushState() {
  undoStack.push({
    layout:   deepCopy(currentLayout),
    unplaced: deepCopy(_unplacedItems),
  });
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  // Toute nouvelle action invalide le redo
  redoStack.length = 0;
  dispatchHistoryChange();
}

/**
 * Annule la dernière mutation (Ctrl+Z).
 */
export function undo() {
  if (undoStack.length === 0) return false;
  // Sauvegarder l'état courant dans redo
  redoStack.push({
    layout:   deepCopy(currentLayout),
    unplaced: deepCopy(_unplacedItems),
  });
  const prev = undoStack.pop();
  setCurrentLayout(prev.layout);
  setUnplacedItems(prev.unplaced);
  dispatchHistoryChange();
  _renderAll?.();
  return true;
}

/**
 * Rétablit la dernière mutation annulée (Ctrl+Y / Ctrl+Shift+Z).
 */
export function redo() {
  if (redoStack.length === 0) return false;
  undoStack.push({
    layout:   deepCopy(currentLayout),
    unplaced: deepCopy(_unplacedItems),
  });
  const next = redoStack.pop();
  setCurrentLayout(next.layout);
  setUnplacedItems(next.unplaced);
  dispatchHistoryChange();
  _renderAll?.();
  return true;
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
