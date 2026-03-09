/**
 * utils.js — Constantes et utilitaires sans dépendances vers les autres modules
 */

export const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
export const COLS = Array.from({ length: 12 }, (_, i) => i + 1);

/** Clé de position d'un puits, ex. "A01", "H12" */
export function wellKey(row, col) {
  return row + String(col).padStart(2, '0');
}

/** Affiche un toast temporaire */
export function toast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), duration);
}

/**
 * Construit la map amorces → index couleur (0–9) pour un programme.
 * @param {object} progData  — un élément de currentLayout.programmes
 * @returns {object}
 */
export function buildAmorceColorMap(progData) {
  const map = {};
  let idx = 0;
  progData.plates.forEach(plate => {
    Object.values(plate.wells).forEach(w => {
      if (w && w.amorces && !(w.amorces in map)) {
        map[w.amorces] = idx % 10;
        idx++;
      }
    });
  });
  return map;
}
