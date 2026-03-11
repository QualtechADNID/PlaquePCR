/**
 * render.js — Fonctions de rendu DOM
 *
 * Dépendances : state.js, utils.js, selection.js, dragdrop.js
 *
 * renderAll() est exporté et appelé après chaque mutation du layout.
 * attachDropHandlers reçoit renderAll en callback pour casser le cycle
 * render → dragdrop → render.
 */

import {
  currentLayout, activeProgIdx, setActiveProgIdx,
  activeProgColorMap, setActiveProgColorMap,
  _unplacedItems,
} from './state.js';
import { ROWS, COLS, wellKey, buildAmorceColorMap, toast } from './utils.js';
import {
  selectedWells, selectedUnplaced, selKey,
  selectRow, selectCol,
  startDragSelect, updateDragSelect, endDragSelect, isDragSelectActive,
  handleUnplacedClick, clearSelection,
} from './selection.js';
import { attachDragHandlers, attachDropHandlers } from './dragdrop.js';
import { handleWellClick } from './selection.js';
import { pushState } from './history.js';
import { getClipboardSourceKeys, hasClipboard, showPreview, clearPreviewDOM, pasteAt } from './clipboard.js';

// ── Plaque survolée (pour Ctrl+A) ─────────────────────────────────────────────

/** Dernière plaque sur laquelle la souris se trouve : { progName, plateNbr } | null */
export let hoveredPlate = null;

// ── Gestion des plaques ───────────────────────────────────────────────────────

/**
 * Ajoute une plaque vide à la fin du programme actif.
 */
function addPlate() {
  const prog = currentLayout.programmes[activeProgIdx];
  if (!prog) return;
  pushState();
  const maxNbr = prog.plates.reduce((m, p) => Math.max(m, p.plate_nbr), 0);
  prog.plates.push({ plate_nbr: maxNbr + 1, amorce_label: null, wells: {} });
  renderAll();
  toast('Plaque ajoutée.');
}

/**
 * Supprime la plaque `plateNbr` du programme actif si elle est vide.
 * Renuméroter les plaques restantes pour garder des numéros consécutifs.
 */
function removePlate(plateNbr) {
  const prog = currentLayout.programmes[activeProgIdx];
  if (!prog) return;
  const plate = prog.plates.find(p => p.plate_nbr === plateNbr);
  if (!plate) return;
  if (Object.keys(plate.wells).length > 0) {
    toast('Impossible de supprimer une plaque non vide.');
    return;
  }
  pushState();
  prog.plates = prog.plates.filter(p => p.plate_nbr !== plateNbr);
  // Renuméroter
  prog.plates.forEach((p, i) => { p.plate_nbr = i + 1; });
  renderAll();
  toast('Plaque supprimée.');
}

// ── Rendu global ──────────────────────────────────────────────────────────────

export function renderAll() {
  renderTabs();
  renderPanels();
  renderStats();
  renderUnplaced();
}

// ── Onglets ───────────────────────────────────────────────────────────────────

export function renderTabs() {
  const tabsEl = document.getElementById('prog-tabs');
  tabsEl.innerHTML = '';
  currentLayout.programmes.forEach((prog, idx) => {
    const btn = document.createElement('button');
    btn.className = `tab-btn px-4 py-2 text-sm font-medium border rounded-lg transition-colors ${
      idx === activeProgIdx ? 'active' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
    }`;
    btn.textContent = `${prog.name} (${prog.plates.length} plaque${prog.plates.length > 1 ? 's' : ''})`;
    btn.onclick = () => {
      setActiveProgIdx(idx);
      renderAll();
    };
    tabsEl.appendChild(btn);
  });

  // Bouton "Séparer par amorces"
  if (currentLayout.programmes.length > 0) {
    const sep = document.createElement('button');
    sep.id = 'btn-split-amorces';
    sep.className = 'ml-auto px-3 py-2 text-xs font-medium border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 transition-colors flex items-center gap-1.5';
    sep.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h8M8 12h4m-4 5h8M4 4h16v16H4z"/>
      </svg>
      Séparer par amorces`;
    sep.title = 'Crée une plaque par amorce — les groupes rares sont placés en fin';
    // splitByAmorces est branché dans main.js via l'événement délégué
    sep.dataset.action = 'split-amorces';
    tabsEl.appendChild(sep);
  }
}

// ── Plaques du programme actif ────────────────────────────────────────────────

export function renderPanels() {
  const panelsEl = document.getElementById('prog-panels');
  panelsEl.innerHTML = '';

  if (currentLayout.programmes.length === 0) {
    panelsEl.innerHTML = '<p class="text-gray-400">Aucune donnée.</p>';
    return;
  }

  // Clamp activeProgIdx si le layout a changé
  if (activeProgIdx >= currentLayout.programmes.length) setActiveProgIdx(0);

  const prog = currentLayout.programmes[activeProgIdx];
  setActiveProgColorMap(buildAmorceColorMap(currentLayout));
  renderLegend(activeProgColorMap);

  prog.plates.forEach(plate => {
    const section = document.createElement('section');
    section.className = 'bg-white rounded-2xl shadow p-5 mb-6';
    section.dataset.prog  = prog.name;
    section.dataset.plate = plate.plate_nbr;
    section.addEventListener('mouseenter', () => {
      hoveredPlate = { progName: prog.name, plateNbr: plate.plate_nbr };
    });
    section.addEventListener('mouseleave', () => {
      hoveredPlate = null;
    });

    const occ = Object.keys(plate.wells).length;
    const pct = Math.round(occ / 96 * 100);
    const plateTitle = plate.amorce_label
      ? `Plaque ${plate.plate_nbr} — <span class="amorce-badge">${plate.amorce_label}</span>`
      : `Plaque ${plate.plate_nbr}`;

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between mb-4';
    header.innerHTML = `
      <h2 class="text-base font-semibold text-gray-800">${plateTitle}</h2>
      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-500">${occ}/96 puits occupés (${pct}%)</span>
      </div>
    `;

    // Bouton supprimer — visible seulement si la plaque est vide
    const delBtn = document.createElement('button');
    delBtn.className = 'plate-delete-btn';
    delBtn.title = occ === 0 ? 'Supprimer cette plaque' : 'La plaque doit être vide pour être supprimée';
    delBtn.disabled = occ > 0;
    delBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3M3 7h18"/>
      </svg>
      Supprimer`;
    delBtn.addEventListener('click', () => removePlate(plate.plate_nbr));
    header.querySelector('.flex.items-center.gap-3').appendChild(delBtn);

    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'plate-grid';

    // Coin supérieur gauche vide
    const corner = document.createElement('div');
    corner.className = 'well-header';
    grid.appendChild(corner);

    // En-têtes colonnes (cliquables → sélection colonne)
    COLS.forEach(c => {
      const th = document.createElement('div');
      th.className = 'well-header clickable';
      th.textContent = c;
      th.title = `Sélectionner colonne ${c}`;
      th.addEventListener('click', e => {
        selectCol(prog.name, plate.plate_nbr, c, e.ctrlKey || e.metaKey);
      });
      grid.appendChild(th);
    });

    // Lignes A–H
    ROWS.forEach(row => {
      const rh = document.createElement('div');
      rh.className = 'well-header clickable';
      rh.textContent = row;
      rh.title = `Sélectionner ligne ${row}`;
      rh.addEventListener('click', e => {
        selectRow(prog.name, plate.plate_nbr, row, e.ctrlKey || e.metaKey);
      });
      grid.appendChild(rh);

      COLS.forEach(col => {
        const key = wellKey(row, col);
        const wellData = plate.wells[key] || null;
        const div = createWellElement(prog.name, plate.plate_nbr, key, wellData);
        grid.appendChild(div);
      });
    });

    section.appendChild(grid);
    panelsEl.appendChild(section);
  });

  // Bouton "+ Ajouter une plaque" en bas
  const addBtn = document.createElement('button');
  addBtn.className = 'plate-add-btn';
  addBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
    </svg>
    Ajouter une plaque`;
  addBtn.addEventListener('click', addPlate);
  panelsEl.appendChild(addBtn);
}

// ── Élément puits ─────────────────────────────────────────────────────────────

export function createWellElement(progName, plateNbr, wKey, wellData) {
  const div = document.createElement('div');
  div.className = 'well';
  div.dataset.prog  = progName;
  div.dataset.plate = plateNbr;
  div.dataset.well  = wKey;

  if (wellData) {
    const isBlank = !!wellData.is_blank;

    if (isBlank) {
      div.classList.add('blank');
    } else {
      const colorIdx = activeProgColorMap[wellData.amorces] ?? 0;
      div.classList.add('occupied', `well-color-${colorIdx}`);
    }

    if (selectedWells.has(selKey(progName, plateNbr, wKey))) {
      div.classList.add('selected');
    }
    // Marquer visuellement les puits coupés (dans le clipboard)
    const cutKey = selKey(progName, plateNbr, wKey);
    if (getClipboardSourceKeys().has(cutKey)) {
      div.classList.add('cut');
    }
    div.setAttribute('draggable', 'true');
    div.dataset.wellData = JSON.stringify(wellData);
    div.dataset.source   = 'plate';

    if (isBlank) {
      div.innerHTML = `
        <span class="blank-label">Blanc</span>
        <span class="blank-name">${wellData.content || ''}</span>
        <div class="well-tooltip">
          <div><strong>${wellData.content || 'Blanc'}</strong></div>
          <div class="text-gray-300 italic">Puits blanc</div>
          <div class="text-gray-400 text-xs">${progName} — Plaque ${plateNbr} — ${wKey}</div>
        </div>
      `;
    } else {
      div.innerHTML = `
        <span class="truncate block w-full text-center">${wellData.content}</span>
        <div class="well-tooltip">
          <div><strong>${wellData.code_labo}</strong>${wellData.instance && wellData.instance !== '1' ? ' #' + wellData.instance : ''}</div>
          <div class="text-yellow-300">${wellData.amorces}</div>
          ${wellData.dilution ? `<div class="text-gray-300">Dil: ${wellData.dilution}</div>` : ''}
          <div class="text-gray-400 text-xs">${progName} — Plaque ${plateNbr} — ${wKey}</div>
        </div>
      `;
    }

    attachDragHandlers(div);
  }

  div.addEventListener('click', e => {
    // En mode paste : clic = coller ici, pas sélectionner
    if (hasClipboard()) {
      e.stopPropagation();
      pasteAt(progName, plateNbr, wKey);
      return;
    }
    handleWellClick(e, progName, plateNbr, wKey, wellData);
  });
  attachDropHandlers(div, renderAll);

  // ── Mode paste : hover → prévisualisation ─────────────────────────────────
  div.addEventListener('mouseenter', () => {
    if (hasClipboard()) showPreview(progName, plateNbr, wKey);
    else if (isDragSelectActive()) updateDragSelect(progName, plateNbr, wKey);
  });
  div.addEventListener('mouseleave', () => {
    if (hasClipboard()) clearPreviewDOM();
  });

  // ── Drag-select lasso (mousedown) ─────────────────────────────────────────
  // Sur puits vide → lasso immédiat.
  // Sur puits occupé + Ctrl/Shift → lasso additif.
  // Sur puits occupé sans modificateur → on laisse le DnD HTML5 démarrer ;
  //   le navigateur distingue clic (→ handleWellClick via 'click') de drag (→ dragstart).
  div.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (hasClipboard()) return; // en mode paste, mousedown ne fait rien
    const isOccupied = !!wellData;
    const hasModifier = e.ctrlKey || e.metaKey || e.shiftKey;
    if (isOccupied && !hasModifier) return; // DnD ou clic simple : laisser le navigateur décider
    e.preventDefault();
    startDragSelect(progName, plateNbr, wKey, e.ctrlKey || e.metaKey);
  });

  return div;
}

// ── Légende ───────────────────────────────────────────────────────────────────

export function renderLegend(colorMap) {
  const container = document.getElementById('legend-container');
  container.innerHTML = '';
  if (Object.keys(colorMap).length === 0) {
    container.innerHTML = '<p class="text-gray-400">—</p>';
    return;
  }
  Object.entries(colorMap).forEach(([amorces, colorIdx]) => {
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2 py-0.5';
    div.innerHTML = `<span class="w-3 h-3 rounded-full flex-shrink-0 legend-dot-${colorIdx}"></span>
      <span class="truncate text-xs text-gray-700" title="${amorces}">${amorces}</span>`;
    container.appendChild(div);
  });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function renderStats() {
  const container = document.getElementById('stats-container');
  container.innerHTML = '';
  let totalSamples = 0;
  let totalBlanks  = 0;
  let totalPlates  = 0;
  currentLayout.programmes.forEach(prog => {
    totalPlates += prog.plates.length;
    prog.plates.forEach(plate => {
      Object.values(plate.wells).forEach(w => {
        if (w.is_blank) totalBlanks++;
        else totalSamples++;
      });
    });
  });
  container.innerHTML = `
    <div class="flex justify-between"><span class="text-gray-500">Programmes</span><strong>${currentLayout.programmes.length}</strong></div>
    <div class="flex justify-between"><span class="text-gray-500">Plaques total</span><strong>${totalPlates}</strong></div>
    <div class="flex justify-between"><span class="text-gray-500">Échantillons</span><strong>${totalSamples}</strong></div>
    ${totalBlanks > 0 ? `<div class="flex justify-between"><span class="text-gray-500">Blancs</span><strong>${totalBlanks}</strong></div>` : ''}
  `;
}

// ── Puits non assignés ────────────────────────────────────────────────────────

export function renderUnplaced() {
  const container = document.getElementById('unplaced-container');
  const emptyMsg  = document.getElementById('unplaced-empty-msg');
  Array.from(container.querySelectorAll('.unplaced-item')).forEach(el => el.remove());

  if (_unplacedItems.length === 0) {
    emptyMsg.classList.remove('hidden');
  } else {
    emptyMsg.classList.add('hidden');
    _unplacedItems.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = 'unplaced-item';
      div.setAttribute('draggable', 'true');
      div.dataset.wellData = JSON.stringify(item);
      div.dataset.source   = 'unplaced';
      div.dataset.idx      = idx;
      div.textContent      = item.content;
      div.title = `${item.code_labo} | ${item.amorces} | ${item.dilution ?? ''}`;

      if (selectedUnplaced.has(idx)) div.classList.add('selected');

      div.addEventListener('click', e => handleUnplacedClick(e, idx, _unplacedItems.length));
      attachDragHandlers(div);
      container.appendChild(div);
    });
  }

  // Clic sur le fond du conteneur (pas sur un item) → déselectionner
  container.onclick = e => {
    if (e.target === container || e.target === emptyMsg) clearSelection();
  };
}
