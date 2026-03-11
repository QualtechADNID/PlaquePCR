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
 * Construit la map amorces → index couleur (0–15) pour l'ensemble du layout.
 * L'ordre est déterministe (tri alphabétique) pour que les couleurs
 * ne changent pas quand les puits sont déplacés, et cohérent entre tous
 * les programmes.
 * @param {object} layout  — currentLayout complet ({ programmes: [...] })
 * @returns {object}
 */
export function buildAmorceColorMap(layout) {
  const amorcesSet = new Set();
  layout.programmes.forEach(prog => {
    prog.plates.forEach(plate => {
      Object.values(plate.wells).forEach(w => {
        if (w && w.amorces && !w.is_blank) amorcesSet.add(w.amorces);
      });
    });
  });
  const map = {};
  [...amorcesSet].sort().forEach((amorces, idx) => {
    map[amorces] = idx % 16;
  });
  return map;
}
