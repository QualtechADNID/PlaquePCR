/**
 * dragdrop.js — Drag & Drop des puits de plaque
 *
 * Dépendances : state.js, utils.js, selection.js
 * Note : renderAll est passé en paramètre (callback) pour éviter le cycle render → dragdrop → render
 */

import { currentLayout, _unplacedItems } from './state.js';
import { ROWS, COLS, wellKey } from './utils.js';
import {
  selectedWells, lastSelectedKey, setLastSelectedKey,
  selKey, parseSelKey, clearSelection, updateSelectionBar,
} from './selection.js';
import { toast } from './utils.js';

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

export function attachDragHandlers(el) {
  el.addEventListener('dragstart', e => {
    const data = JSON.parse(el.dataset.wellData || '{}');
    const k = selKey(el.dataset.prog, parseInt(el.dataset.plate), el.dataset.well);

    // Si l'élément dragué ne fait pas partie de la sélection → sélection = 1
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
    e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragend', () => {
    document.querySelectorAll('.well.dragging').forEach(w => w.classList.remove('dragging'));
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

    if (selectedWells.size > 1) {
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
  // Récupérer les données de tous les puits sélectionnés
  const toMove = [];
  selectedWells.forEach(k => {
    const { progName: pn, plateNbr, wKey: wk } = parseSelKey(k);
    const data = getWell(pn, plateNbr, wk);
    if (data) toMove.push({ srcProgName: pn, srcPlateNbr: plateNbr, srcWellKey: wk, data });
  });

  if (toMove.length === 0) return;

  // Générer toutes les positions de la plaque cible (colonne par colonne)
  const allPositions = [];
  COLS.forEach(c => ROWS.forEach(r => allPositions.push(wellKey(r, c))));
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

  const isSamePlate = (
    toMove[0].srcProgName === targetProgName &&
    toMove[0].srcPlateNbr === targetPlateNbr
  );
  const freePositions = orderedPositions.filter(pos => {
    const occupied = !!targetPlate.wells[pos];
    if (!occupied) return true;
    if (isSamePlate && movingKeys.has(pos)) return true;
    return false;
  });

  if (freePositions.length < toMove.length) {
    toast(`Pas assez de puits libres (${freePositions.length} dispo, ${toMove.length} sélectionnés).`);
    return;
  }

  // Vider les sources puis placer
  toMove.forEach(m => setWell(m.srcProgName, m.srcPlateNbr, m.srcWellKey, null));
  toMove.forEach((m, i) => setWell(targetProgName, targetPlateNbr, freePositions[i], m.data));

  renderAll();
  clearSelection();
  toast(`${toMove.length} puits déplacés.`);
}
