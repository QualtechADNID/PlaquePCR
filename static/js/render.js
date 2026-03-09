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
import { selectedWells, selKey } from './selection.js';
import { attachDragHandlers, attachDropHandlers } from './dragdrop.js';
import { handleWellClick } from './selection.js';

// ── Gestion des plaques ───────────────────────────────────────────────────────

/**
 * Ajoute une plaque vide à la fin du programme actif.
 */
function addPlate() {
  const prog = currentLayout.programmes[activeProgIdx];
  if (!prog) return;
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
  setActiveProgColorMap(buildAmorceColorMap(prog));
  renderLegend(activeProgColorMap);

  prog.plates.forEach(plate => {
    const section = document.createElement('section');
    section.className = 'bg-white rounded-2xl shadow p-5 mb-6';

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

    // En-têtes colonnes
    COLS.forEach(c => {
      const th = document.createElement('div');
      th.className = 'well-header';
      th.textContent = c;
      grid.appendChild(th);
    });

    // Lignes A–H
    ROWS.forEach(row => {
      const rh = document.createElement('div');
      rh.className = 'well-header';
      rh.textContent = row;
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
    const colorIdx = activeProgColorMap[wellData.amorces] ?? 0;
    div.classList.add('occupied', `well-color-${colorIdx}`);
    if (selectedWells.has(selKey(progName, plateNbr, wKey))) {
      div.classList.add('selected');
    }
    div.setAttribute('draggable', 'true');
    div.dataset.wellData = JSON.stringify(wellData);
    div.dataset.source   = 'plate';

    div.innerHTML = `
      <span class="truncate block w-full text-center">${wellData.content}</span>
      <div class="well-tooltip">
        <div><strong>${wellData.code_labo}</strong>${wellData.instance && wellData.instance !== '1' ? ' #' + wellData.instance : ''}</div>
        <div class="text-yellow-300">${wellData.amorces}</div>
        ${wellData.dilution ? `<div class="text-gray-300">Dil: ${wellData.dilution}</div>` : ''}
        <div class="text-gray-400 text-xs">${progName} — Plaque ${plateNbr} — ${wKey}</div>
      </div>
    `;

    attachDragHandlers(div);
  }

  div.addEventListener('click', e => handleWellClick(e, progName, plateNbr, wKey, wellData));
  attachDropHandlers(div, renderAll);
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
  let totalPlates  = 0;
  currentLayout.programmes.forEach(prog => {
    totalPlates += prog.plates.length;
    prog.plates.forEach(plate => {
      totalSamples += Object.keys(plate.wells).length;
    });
  });
  container.innerHTML = `
    <div class="flex justify-between"><span class="text-gray-500">Programmes</span><strong>${currentLayout.programmes.length}</strong></div>
    <div class="flex justify-between"><span class="text-gray-500">Plaques total</span><strong>${totalPlates}</strong></div>
    <div class="flex justify-between"><span class="text-gray-500">Échantillons</span><strong>${totalSamples}</strong></div>
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
    _unplacedItems.forEach(item => {
      const div = document.createElement('div');
      div.className = 'unplaced-item';
      div.setAttribute('draggable', 'true');
      div.dataset.wellData = JSON.stringify(item);
      div.dataset.source   = 'unplaced';
      div.textContent      = item.content;
      div.title = `${item.code_labo} | ${item.amorces} | ${item.dilution}`;
      attachDragHandlers(div);
      container.appendChild(div);
    });
  }
}
