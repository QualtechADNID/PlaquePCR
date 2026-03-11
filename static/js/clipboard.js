/**
 * clipboard.js — Couper / Coller des puits avec préservation des écarts
 *
 * Comportement :
 *   Ctrl+X  → cut()         : mémorise la sélection courante, marque les puits "cut"
 *   Hover   → showPreview() : prévisualise le bloc à coller sous le curseur
 *   Clic    → pasteAt()     : colle directement au puits survolé
 *   Escape  → cancelCut()   : annule le mode coupe
 *
 * Règles du collage :
 *   - Les écarts relatifs entre puits coupés sont conservés
 *   - La position anchor est le coin supérieur-gauche du bloc collé
 *   - Si un puits destination est occupé (et pas dans le clipboard),
 *     l'échantillon écrasé va dans "puits non assignés"
 *   - Si un puits cible dépasse la plaque (H12), la preview s'affiche en rouge
 *
 * Dépendances : state.js, utils.js, selection.js, history.js
 */

import { currentLayout, _unplacedItems } from './state.js';
import { ROWS, COLS, wellKey, toast } from './utils.js';
import { selectedWells, parseSelKey, clearSelection } from './selection.js';
import { pushState } from './history.js';

// ── État du presse-papier ─────────────────────────────────────────────────────

/**
 * clipboard = {
 *   progName  : string,
 *   plateNbr  : number,
 *   items     : [{ rowOffset, colOffset, srcPlateNbr, srcProgName, srcWKey, data }],
 *   sourceKeys: Set<string>   // selKeys d'origine pour le style "cut"
 * }
 */
let clipboard = null;

export function hasClipboard() { return clipboard !== null; }
export function getClipboardSourceKeys() { return clipboard?.sourceKeys ?? new Set(); }

/** En mode paste, la dernière preview calculée */
let _currentPreview = null; // { progName, plateNbr, wKey, valid, targets }

/** Callback branché depuis main.js */
let _renderAll = null;
export function setClipboardRenderCallback(fn) { _renderAll = fn; }

// ── Ordre canonique des positions (colonne par colonne) ───────────────────────

const ALL_POSITIONS = [];  // ["A01","B01",..."H01","A02",...]
COLS.forEach(c => ROWS.forEach(r => ALL_POSITIONS.push(wellKey(r, c))));

function posIndex(wKey) { return ALL_POSITIONS.indexOf(wKey); }

// ── Décomposer une clé de puits en {row, col} ─────────────────────────────────
function parseWellKey(wKey) {
  return { row: wKey[0], col: parseInt(wKey.slice(1), 10) };
}

function buildWellKey(row, col) {
  if (col < 1 || col > 12) return null;
  const rIdx = ROWS.indexOf(row);
  if (rIdx === -1) return null;
  return wellKey(row, col);
}

// ── Lire / écrire dans le layout ─────────────────────────────────────────────

function getWell(progName, plateNbr, wKey) {
  const prog  = currentLayout.programmes.find(p => p.name === progName);
  const plate = prog?.plates.find(p => p.plate_nbr === plateNbr);
  return plate?.wells[wKey] ?? null;
}

function setWell(progName, plateNbr, wKey, data) {
  const prog  = currentLayout.programmes.find(p => p.name === progName);
  const plate = prog?.plates.find(p => p.plate_nbr === plateNbr);
  if (!plate) return;
  if (data === null) { delete plate.wells[wKey]; }
  else               { plate.wells[wKey] = data; }
}

// ── Cut ───────────────────────────────────────────────────────────────────────

export function cut() {
  if (selectedWells.size === 0) {
    toast('Aucun puits sélectionné.');
    return;
  }

  // Tous les puits sélectionnés doivent être dans le même programme
  const parsed = [...selectedWells].map(parseSelKey);
  const progNames = new Set(parsed.map(p => p.progName));
  if (progNames.size > 1) {
    toast('Impossible de couper des puits de programmes différents.');
    return;
  }

  // Ne garder que les puits occupés
  const occupied = parsed.filter(({ progName, plateNbr, wKey }) =>
    getWell(progName, plateNbr, wKey) !== null
  );
  if (occupied.length === 0) {
    toast('Aucun puits occupé dans la sélection.');
    return;
  }

  const plateNbr = occupied[0].plateNbr;
  const progName = occupied[0].progName;

  // Trier par position canonique
  occupied.sort((a, b) => posIndex(a.wKey) - posIndex(b.wKey));

  // Référence = premier puits (coin supérieur-gauche)
  const anchor = parseWellKey(occupied[0].wKey);

  const items = occupied.map(({ wKey, plateNbr: pn, progName: pg }) => {
    const { row, col } = parseWellKey(wKey);
    return {
      rowOffset: ROWS.indexOf(row) - ROWS.indexOf(anchor.row),
      colOffset: col - anchor.col,
      srcPlateNbr: pn,
      srcProgName: pg,
      srcWKey: wKey,
      data: JSON.parse(JSON.stringify(getWell(pg, pn, wKey))),
    };
  });

  clipboard = {
    progName,
    plateNbr,
    items,
    sourceKeys: new Set([...selectedWells]),
  };
  _currentPreview = null;

  clearSelection();
  _renderAll?.();
  toast(`${items.length} puits coupé${items.length > 1 ? 's' : ''} — survolez la destination et cliquez, ou Ctrl+V.`);
}

// ── Calcul de la preview ──────────────────────────────────────────────────────

/**
 * Calcule les positions cibles si on collait à (progName, plateNbr, anchorWKey).
 * Retourne { valid: bool, targets: [{ wKey, data, isSource, willEvict }] }
 */
export function computePreview(progName, plateNbr, anchorWKey) {
  if (!clipboard) return null;

  const dstAnchor = parseWellKey(anchorWKey);
  const srcKeys = new Set(clipboard.items.map(i =>
    `${i.srcProgName}\x00${i.srcPlateNbr}\x00${i.srcWKey}`
  ));

  let valid = true;
  const targets = [];

  for (const item of clipboard.items) {
    const tRow = ROWS[ROWS.indexOf(dstAnchor.row) + item.rowOffset];
    const tCol = dstAnchor.col + item.colOffset;
    const tKey = tRow ? buildWellKey(tRow, tCol) : null;

    if (!tKey) { valid = false; targets.push({ wKey: null, data: item.data, outOfBounds: true }); continue; }

    const isSource = srcKeys.has(`${progName}\x00${plateNbr}\x00${tKey}`);
    const existing = getWell(progName, plateNbr, tKey);
    targets.push({
      wKey: tKey,
      data: item.data,
      isSource,
      willEvict: !!(existing && !isSource),
    });
  }

  // Collision cible-cible
  const targetWKeys = targets.map(t => t.wKey).filter(Boolean);
  if (new Set(targetWKeys).size < targetWKeys.length) valid = false;

  return { valid, targets };
}

// ── Preview DOM ───────────────────────────────────────────────────────────────

/** Applique la preview visuelle sur les puits du DOM. */
export function showPreview(progName, plateNbr, anchorWKey) {
  if (!clipboard) return;
  clearPreviewDOM();

  const preview = computePreview(progName, plateNbr, anchorWKey);
  if (!preview) return;
  _currentPreview = { progName, plateNbr, wKey: anchorWKey, ...preview };

  preview.targets.forEach(t => {
    if (!t.wKey) return;
    const el = document.querySelector(
      `.well[data-prog="${progName}"][data-plate="${plateNbr}"][data-well="${t.wKey}"]`
    );
    if (!el) return;
    el.classList.add(preview.valid ? 'paste-valid' : 'paste-invalid');
  });
}

/** Retire toutes les classes de preview du DOM. */
export function clearPreviewDOM() {
  document.querySelectorAll('.paste-valid, .paste-invalid').forEach(el => {
    el.classList.remove('paste-valid', 'paste-invalid');
  });
  _currentPreview = null;
}

// ── Paste ─────────────────────────────────────────────────────────────────────

/**
 * Colle le clipboard à la position (progName, plateNbr, anchorWKey).
 * Si appelé sans arguments, utilise le premier puits sélectionné (Ctrl+V classique).
 */
export function pasteAt(progName, plateNbr, anchorWKey) {
  if (!clipboard) {
    toast('Presse-papier vide.');
    return;
  }

  // Mode Ctrl+V sans argument → utiliser la sélection courante
  if (!progName) {
    if (selectedWells.size === 0) {
      toast('Survolez ou sélectionnez le puits de destination.');
      return;
    }
    const dstParsed = [...selectedWells].map(parseSelKey);
    dstParsed.sort((a, b) => posIndex(a.wKey) - posIndex(b.wKey));
    const dst = dstParsed[0];
    pasteAt(dst.progName, dst.plateNbr, dst.wKey);
    return;
  }

  const preview = computePreview(progName, plateNbr, anchorWKey);
  if (!preview || !preview.valid) {
    toast('Collage impossible : puits hors limites ou collision.');
    return;
  }

  const srcKeys = new Set(clipboard.items.map(i =>
    `${i.srcProgName}\x00${i.srcPlateNbr}\x00${i.srcWKey}`
  ));

  pushState();

  // 1. Retirer les puits source du layout
  for (const item of clipboard.items) {
    setWell(item.srcProgName, item.srcPlateNbr, item.srcWKey, null);
  }

  // 2. Évincer les occupants non-sources vers unplaced
  for (const t of preview.targets) {
    if (!t.wKey) continue;
    const existing = getWell(progName, plateNbr, t.wKey);
    if (existing && !srcKeys.has(`${progName}\x00${plateNbr}\x00${t.wKey}`)) {
      _unplacedItems.push(existing);
    }
  }

  // 3. Placer les données sur les cibles
  for (const t of preview.targets) {
    if (t.wKey) setWell(progName, plateNbr, t.wKey, t.data);
  }

  const count = preview.targets.filter(t => t.wKey).length;
  clipboard = null;
  _currentPreview = null;
  clearPreviewDOM();
  clearSelection();
  _renderAll?.();
  toast(`${count} puits collé${count > 1 ? 's' : ''}.`);
}

/** Alias Ctrl+V (sans position explicite) */
export function paste() { pasteAt(); }

// ── Annuler le cut en cours (Échap) ──────────────────────────────────────────

export function cancelCut() {
  if (!clipboard) return;
  clipboard = null;
  _currentPreview = null;
  clearPreviewDOM();
  _renderAll?.();
  toast('Couper annulé.');
}
