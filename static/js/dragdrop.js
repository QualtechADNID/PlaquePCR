/**
 * dragdrop.js — Drag & Drop des puits de plaque
 *
 * Dépendances : state.js, utils.js, selection.js, history.js
 * Note : renderAll est passé en paramètre (callback) pour éviter le cycle render → dragdrop → render
 */

import { currentLayout, _unplacedItems } from './state.js';
import { ROWS, COLS, wellKey } from './utils.js';
import {
  selectedWells, selectedUnplaced, lastSelectedKey, setLastSelectedKey,
  selKey, parseSelKey, clearSelection, updateSelectionBar, syncUnplacedSelectionDOM,
} from './selection.js';
import { toast } from './utils.js';
import { pushState } from './history.js';

/** Source du drag courant : { type, prog, plate, well, data } */
export let dragSource = null;

// ── Lecture / écriture des puits dans le layout ──────────────────────────────

export function getWell(progName, plateNbr, wKey) {
  const prog = currentLayout.programmes.find(p => p.name === progName);
  if (!prog) return null;
  const plate = prog.plates.find(p => p.plate_nbr === plateNbr);
  if (!plate) return null;
  return plate.wells[wKey] || null;
}

export function setWell(progName, plateNbr, wKey, data) {
  const prog = currentLayout.programmes.find(p => p.name === progName);
  if (!prog) return;
  const plate = prog.plates.find(p => p.plate_nbr === plateNbr);
  if (!plate) return;
  if (data === null) {
    delete plate.wells[wKey];
  } else {
    plate.wells[wKey] = data;
  }
}

export function removeSampleFromPlate(progName, plateNbr, wKey) {
  setWell(progName, plateNbr, wKey, null);
}

// ── Gestionnaires drag ────────────────────────────────────────────────────────

/** Crée et retourne un élément DOM hors-écran utilisé comme ghost image de drag. */
function createDragGhost(count) {
  const ghost = document.createElement('div');
  ghost.style.cssText = [
    'position:fixed', 'top:-200px', 'left:-200px',
    'background:#4f46e5', 'color:#fff',
    'border-radius:8px', 'padding:6px 14px',
    'font:600 0.78rem/1.4 system-ui,sans-serif',
    'box-shadow:0 4px 12px rgba(0,0,0,0.35)',
    'pointer-events:none', 'white-space:nowrap',
  ].join(';');
  ghost.textContent = count > 1 ? `${count} échantillons` : '1 échantillon';
  document.body.appendChild(ghost);
  return ghost;
}

export function attachDragHandlers(el) {
  el.addEventListener('dragstart', e => {
    const data = JSON.parse(el.dataset.wellData || '{}');
    const source = el.dataset.source;

    if (source === 'unplaced') {
      const idx = el.dataset.idx !== undefined ? parseInt(el.dataset.idx) : null;
      // Si l'item dragué n'est pas sélectionné → sélection = lui seul
      if (idx !== null && !selectedUnplaced.has(idx)) {
        selectedUnplaced.clear();
        selectedUnplaced.add(idx);
        syncUnplacedSelectionDOM();
      }
      dragSource = { type: 'unplaced', data, idx };
      document.querySelectorAll('.unplaced-item.selected').forEach(w => w.classList.add('dragging'));

      // Ghost image
      const count = selectedUnplaced.size;
      const ghost = createDragGhost(count);
      e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
      requestAnimationFrame(() => ghost.remove());
    } else {
      const k = selKey(el.dataset.prog, parseInt(el.dataset.plate), el.dataset.well);
      if (!selectedWells.has(k)) {
        clearSelection();
        selectedWells.add(k);
        setLastSelectedKey(k);
        el.classList.add('selected');
        updateSelectionBar();
      }
      dragSource = {
        type: el.dataset.source,
        prog: el.dataset.prog || data.programme,
        plate: el.dataset.plate ? parseInt(el.dataset.plate) : null,
        well: el.dataset.well || null,
        data,
      };
      document.querySelectorAll('.well.selected').forEach(w => w.classList.add('dragging'));

      // Ghost image
      const count = selectedWells.size;
      const ghost = createDragGhost(count);
      e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
      requestAnimationFrame(() => ghost.remove());
    }

    e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragend', () => {
    document.querySelectorAll('.well.dragging').forEach(w => w.classList.remove('dragging'));
    document.querySelectorAll('.unplaced-item.dragging').forEach(w => w.classList.remove('dragging'));
    dragSource = null;
  });
}

export function attachDropHandlers(el, renderAll) {
  el.addEventListener('dragover', e => {
    e.preventDefault();
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drag-over');
    if (!dragSource) return;

    const targetProg  = el.dataset.prog;
    const targetPlate = el.dataset.plate ? parseInt(el.dataset.plate) : null;
    const targetWell  = el.dataset.well;

    if (!targetProg || !targetPlate || !targetWell) return;

    if (dragSource.type === 'unplaced') {
      // Déplacer tous les items non assignés sélectionnés vers la plaque cible
      performMultiUnplacedMove(targetProg, targetPlate, targetWell, renderAll);
    } else if (selectedWells.size > 1) {
      performMultiMove(targetProg, targetPlate, targetWell, renderAll);
    } else {
      if (
        dragSource.type === 'plate' &&
        dragSource.prog === targetProg &&
        dragSource.plate === targetPlate &&
        dragSource.well === targetWell
      ) return;
      performSwap(dragSource, { prog: targetProg, plate: targetPlate, well: targetWell }, renderAll);
    }
  });
}

// ── Logique de déplacement ────────────────────────────────────────────────────

export function performSwap(src, dst, renderAll) {
  let srcData = null;

  if (src.type === 'plate') {
    srcData = getWell(src.prog, src.plate, src.well);
  } else if (src.type === 'unplaced') {
    srcData = src.data;
  }

  const dstData = getWell(dst.prog, dst.plate, dst.well);

  pushState();

  if (src.type === 'plate') {
    setWell(src.prog, src.plate, src.well, dstData);
  } else if (src.type === 'unplaced') {
    const idx = _unplacedItems.findIndex(
      i => i.content === srcData.content && i.code_labo === srcData.code_labo
    );
    if (idx !== -1) _unplacedItems.splice(idx, 1);
    if (dstData) _unplacedItems.push(dstData);
  }

  setWell(dst.prog, dst.plate, dst.well, srcData);
  renderAll();
  clearSelection();
  toast('Puits mis à jour.');
}

export function performMultiMove(targetProgName, targetPlateNbr, targetWellKey, renderAll) {
  // Générer toutes les positions de la plaque (colonne par colonne) — sert de référence d'ordre
  const allPositions = [];
  COLS.forEach(c => ROWS.forEach(r => allPositions.push(wellKey(r, c))));

  // Récupérer les données de tous les puits sélectionnés,
  // TRIÉS dans l'ordre canonique de la grille (colonne par colonne) pour préserver
  // la disposition relative lors du déplacement.
  const toMove = [];
  selectedWells.forEach(k => {
    const { progName: pn, plateNbr, wKey: wk } = parseSelKey(k);
    const data = getWell(pn, plateNbr, wk);
    if (data) toMove.push({ srcProgName: pn, srcPlateNbr: plateNbr, srcWellKey: wk, data });
  });
  toMove.sort((a, b) => allPositions.indexOf(a.srcWellKey) - allPositions.indexOf(b.srcWellKey));

  if (toMove.length === 0) return;

  const startIdx = allPositions.indexOf(targetWellKey);
  const orderedPositions = [
    ...allPositions.slice(startIdx),
    ...allPositions.slice(0, startIdx),
  ];

  const movingKeys = new Set(toMove.map(m => m.srcWellKey));
  const targetProg = currentLayout.programmes.find(p => p.name === targetProgName);
  if (!targetProg) return;
  const targetPlate = targetProg.plates.find(p => p.plate_nbr === targetPlateNbr);
  if (!targetPlate) return;

  // Une position source est "libre" pour la cible si tous les items qui l'occupent
  // font partie du déplacement (même plaque ET même programme).
  const movingFullKeys = new Set(toMove.map(m => `${m.srcProgName}\x00${m.srcPlateNbr}\x00${m.srcWellKey}`));
  const freePositions = orderedPositions.filter(pos => {
    const occupied = !!targetPlate.wells[pos];
    if (!occupied) return true;
    // Si ce puits est une source du déplacement sur la même plaque → sera vidé avant placement
    if (movingFullKeys.has(`${targetProgName}\x00${targetPlateNbr}\x00${pos}`)) return true;
    return false;
  });

  if (freePositions.length < toMove.length) {
    toast(`Pas assez de puits libres (${freePositions.length} dispo, ${toMove.length} sélectionnés).`);
    return;
  }

  pushState();

  // Vider les sources puis placer
  toMove.forEach(m => setWell(m.srcProgName, m.srcPlateNbr, m.srcWellKey, null));
  toMove.forEach((m, i) => setWell(targetProgName, targetPlateNbr, freePositions[i], m.data));

  renderAll();
  clearSelection();
  toast(`${toMove.length} puits déplacés.`);
}

/**
 * Déplace tous les items non assignés sélectionnés vers la plaque cible,
 * en commençant par la position targetWellKey (colonne par colonne).
 */
export function performMultiUnplacedMove(targetProgName, targetPlateNbr, targetWellKey, renderAll) {
  if (selectedUnplaced.size === 0) return;

  const indices = [...selectedUnplaced].sort((a, b) => a - b);
  const toMove  = indices.map(i => _unplacedItems[i]).filter(Boolean);
  if (toMove.length === 0) return;

  const allPositions = [];
  COLS.forEach(c => ROWS.forEach(r => allPositions.push(wellKey(r, c))));
  const startIdx = allPositions.indexOf(targetWellKey);
  const orderedPositions = [
    ...allPositions.slice(startIdx),
    ...allPositions.slice(0, startIdx),
  ];

  const targetProg = currentLayout.programmes.find(p => p.name === targetProgName);
  if (!targetProg) return;
  const targetPlate = targetProg.plates.find(p => p.plate_nbr === targetPlateNbr);
  if (!targetPlate) return;

  const freePositions = orderedPositions.filter(pos => !targetPlate.wells[pos]);

  if (freePositions.length < toMove.length) {
    toast(`Pas assez de puits libres (${freePositions.length} dispo, ${toMove.length} sélectionnés).`);
    return;
  }

  pushState();

  // Retirer les items de _unplacedItems (en partant de la fin pour ne pas décaler les indices)
  indices.sort((a, b) => b - a).forEach(i => _unplacedItems.splice(i, 1));

  // Placer dans la plaque
  toMove.forEach((item, i) => setWell(targetProgName, targetPlateNbr, freePositions[i], item));

  renderAll();
  clearSelection();
  toast(`${toMove.length} échantillon${toMove.length > 1 ? 's' : ''} placé${toMove.length > 1 ? 's' : ''} dans la plaque.`);
}
