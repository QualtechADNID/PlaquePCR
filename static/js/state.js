/**
 * state.js — État mutable global de l'application
 *
 * Toutes les variables mutables partagées entre modules sont centralisées ici.
 * Les données Flask initiales (LAYOUT, etc.) sont lues depuis window.* et
 * injectées dans le template avant l'import de ce module.
 */

// Deep copy du layout initial fourni par Flask
export let currentLayout = JSON.parse(JSON.stringify(window.LAYOUT));

// Index du programme actif (onglet sélectionné)
export let activeProgIdx = 0;

// Map amorces → index couleur pour le programme actif
export let activeProgColorMap = {};

// Items retirés des plaques (zone "non assignés")
export let _unplacedItems = [];

// Setters (pour modifier l'état depuis les autres modules)
export function setCurrentLayout(val) { currentLayout = val; }
export function setActiveProgIdx(val) { activeProgIdx = val; }
export function setActiveProgColorMap(val) { activeProgColorMap = val; }
export function setUnplacedItems(val) { _unplacedItems = val; }
