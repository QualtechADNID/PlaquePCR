/**
 * add-samples.js — Modale "Ajouter des échantillons manuellement"
 *
 * Fonctionnalités tableau :
 *  - Placeholders BARAAXXXXX / Ex: SM;10;100
 *  - Cellule active mise en évidence
 *  - Sélection de lignes : clic sur #, Shift+clic, Ctrl+clic
 *  - Navigation clavier : Tab / Shift+Tab, flèches ↑↓
 *  - Entrée / flèche bas : auto-incrémente le code labo vers la ligne suivante
 *  - Ctrl+D : fill down (copie la valeur de la 1ère ligne sélectionnée)
 *  - Suppr / Backspace sur lignes sélectionnées (hors édition) : efface contenu
 *  - Copier-coller multi-lignes depuis Excel
 */

import { _unplacedItems } from './state.js';
import { renderAll }       from './render.js';
import { pushState }       from './history.js';
import { toast }           from './utils.js';

// ── Utilitaire : reproduit make_content() de function_pcr.py ─────────────────

function makeContent(codeLabo, instance, dilution) {
  const parts = [codeLabo.trim()];
  const inst  = String(instance || '').trim();
  const dil   = String(dilution  || '').trim();
  if (inst && inst !== '1' && inst !== 'nan') parts.push(inst);
  if (dil  && dil  !== 'nan')                 parts.push(dil);
  return parts.join(' ');
}

// ── Incrément de code labo ────────────────────────────────────────────────────
// "BARAA00042" → "BARAA00043", "BARAA00099" → "BARAA00100"
// Fonctionne sur tout suffixe numérique.

function incrementCode(code) {
  const m = code.match(/^(.*?)(\d+)$/);
  if (!m) return code;
  const prefix = m[1];
  const num    = m[2];
  const next   = String(parseInt(num, 10) + 1).padStart(num.length, '0');
  return prefix + next;
}

// ── Chargement des données distantes (avec cache) ────────────────────────────

let _programmes = null;
let _couples    = null;

async function loadProgrammes() {
  if (_programmes) return _programmes;
  try {
    const resp = await fetch('/api/programmes_pcr');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    _programmes = (await resp.json()).programmes || [];
  } catch (e) {
    _programmes = [];
    console.warn('Impossible de charger les programmes PCR :', e);
  }
  return _programmes;
}

async function loadCouples() {
  if (_couples) return _couples;
  try {
    const resp = await fetch('/api/couples');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    _couples = (await resp.json()).couples || [];
  } catch (e) {
    _couples = [];
    console.warn("Impossible de charger les couples d'amorces :", e);
  }
  return _couples;
}

// ── Couples picker (searchable multi-select custom) ──────────────────────────

const _selectedCouples = new Set();

function initCouplesPicker(couples) {
  const search   = document.getElementById('couples-search');
  const dropdown = document.getElementById('couples-dropdown');
  const tagsEl   = document.getElementById('couples-tags');

  function renderTags() {
    tagsEl.querySelectorAll('.couple-tag').forEach(t => t.remove());
    _selectedCouples.forEach(name => {
      const tag = document.createElement('span');
      tag.className = 'couple-tag inline-flex items-center gap-1 bg-indigo-100 text-indigo-800 ' +
                      'rounded-full px-2 py-0.5 text-xs font-medium';
      tag.innerHTML = `${name}
        <button type="button" class="couple-tag-remove text-indigo-400 hover:text-red-500
                leading-none" data-name="${name}" title="Retirer">×</button>`;
      tagsEl.insertBefore(tag, search);
    });
  }

  function renderDropdown(filter = '') {
    dropdown.innerHTML = '';
    const q = filter.toLowerCase();
    const filtered = couples.filter(c =>
      c.nom_couple.toLowerCase().includes(q) ||
      (c.region || '').toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
      dropdown.innerHTML = '<li class="px-3 py-2 text-gray-400 italic">Aucun résultat</li>';
    } else {
      filtered.forEach(c => {
        const selected = _selectedCouples.has(c.nom_couple);
        const li = document.createElement('li');
        li.className = `px-3 py-1.5 cursor-pointer flex items-center justify-between gap-2
          hover:bg-indigo-50 ${selected ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-gray-700'}`;
        li.dataset.name = c.nom_couple;
        li.dataset.prog = c.programme_pcr_name || '';
        li.innerHTML = `
          <span>
            <span class="font-medium">${c.nom_couple}</span>
            ${c.region ? `<span class="ml-1 text-gray-400 font-normal">${c.region}</span>` : ''}
          </span>
          ${selected ? '<span class="text-indigo-500 text-base">✓</span>' : ''}
        `;
        li.addEventListener('mousedown', e => {
          e.preventDefault();
          toggleCouple(c.nom_couple, c.programme_pcr_name || '');
          renderDropdown(search.value);
        });
        dropdown.appendChild(li);
      });
    }
    dropdown.classList.remove('hidden');
  }

  function toggleCouple(name, progName) {
    if (_selectedCouples.has(name)) {
      _selectedCouples.delete(name);
    } else {
      _selectedCouples.add(name);
      autoFillProgramme(progName);
    }
    renderTags();
  }

  tagsEl.addEventListener('click', e => {
    const btn = e.target.closest('.couple-tag-remove');
    if (!btn) return;
    _selectedCouples.delete(btn.dataset.name);
    renderTags();
  });

  search.addEventListener('focus', () => renderDropdown(search.value));
  search.addEventListener('input', () => renderDropdown(search.value));

  document.addEventListener('mousedown', e => {
    if (!document.getElementById('couples-picker').contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  search.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && search.value === '' && _selectedCouples.size > 0) {
      const last = [..._selectedCouples].at(-1);
      _selectedCouples.delete(last);
      renderTags();
    }
    if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
      search.blur();
    }
  });
}

function autoFillProgramme(progName) {
  if (!progName) return;
  const sel = document.getElementById('add-samples-programme');
  if (!sel.value) {
    const opt = Array.from(sel.options).find(o => o.value === progName);
    if (opt) sel.value = progName;
  }
}

function resetCouplesPicker() {
  _selectedCouples.clear();
  const tagsEl = document.getElementById('couples-tags');
  tagsEl.querySelectorAll('.couple-tag').forEach(t => t.remove());
  const search = document.getElementById('couples-search');
  if (search) search.value = '';
  const dropdown = document.getElementById('couples-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
}

// ── État du tableau ───────────────────────────────────────────────────────────

/** Ligne active (1-indexed) */
let _activeRow = null;
/** Set de lignes sélectionnées (1-indexed) */
const _selectedRows = new Set();
/** Dernière ligne sélectionnée par clic (pour Shift+clic) */
let _lastClickedRow = null;

function getRow(rowIdx) {
  return document.querySelector(`#add-samples-tbody tr[data-row="${rowIdx}"]`);
}

function totalRows() {
  return document.querySelectorAll('#add-samples-tbody tr').length;
}

function syncRowStyles() {
  document.querySelectorAll('#add-samples-tbody tr').forEach(tr => {
    const idx = parseInt(tr.dataset.row, 10);
    const isActive   = idx === _activeRow;
    const isSelected = _selectedRows.has(idx);

    tr.classList.toggle('table-row-active',   isActive);
    tr.classList.toggle('table-row-selected', isSelected && !isActive);
  });
}

/** Active une cellule (focus) et met à jour l'état */
function activateCell(rowIdx, col /* 'code' | 'dil' */) {
  _activeRow = rowIdx;
  syncRowStyles();
  const input = document.querySelector(
    `#add-samples-tbody tr[data-row="${rowIdx}"] .sample-${col}`
  );
  if (input) { input.focus(); input.select(); }
}

// ── Sélection de lignes ───────────────────────────────────────────────────────

function selectRows(indices) {
  _selectedRows.clear();
  indices.forEach(i => _selectedRows.add(i));
  syncRowStyles();
}

function handleRowNumClick(e, rowIdx) {
  e.preventDefault();
  const n = totalRows();

  if (e.shiftKey && _lastClickedRow !== null) {
    const from = Math.min(_lastClickedRow, rowIdx);
    const to   = Math.max(_lastClickedRow, rowIdx);
    if (!e.ctrlKey && !e.metaKey) _selectedRows.clear();
    for (let i = from; i <= to; i++) _selectedRows.add(i);
  } else if (e.ctrlKey || e.metaKey) {
    if (_selectedRows.has(rowIdx)) _selectedRows.delete(rowIdx);
    else _selectedRows.add(rowIdx);
    _lastClickedRow = rowIdx;
  } else {
    _selectedRows.clear();
    _selectedRows.add(rowIdx);
    _lastClickedRow = rowIdx;
  }

  _activeRow = rowIdx;
  syncRowStyles();
}

// ── Génération du tableau ─────────────────────────────────────────────────────

function generateTable(n) {
  const tbody   = document.getElementById('add-samples-tbody');
  const table   = document.getElementById('add-samples-table');
  const hint    = document.getElementById('add-samples-hint');
  const confirm = document.getElementById('add-samples-confirm');

  tbody.innerHTML = '';
  _activeRow = null;
  _selectedRows.clear();
  _lastClickedRow = null;

  for (let i = 1; i <= n; i++) {
    const tr = document.createElement('tr');
    tr.dataset.row = i;

    tr.innerHTML = `
      <td class="table-row-num px-2 py-1 text-gray-400 text-center select-none w-8
                 cursor-pointer hover:bg-indigo-50 hover:text-indigo-600 font-mono">${i}</td>
      <td class="px-2 py-1">
        <input type="text"
               class="sample-code w-full border border-transparent rounded px-2 py-1
                      text-xs focus:outline-none focus:border-indigo-400 focus:bg-white
                      bg-transparent"
               placeholder="BARAAXXXXX"
               data-row="${i}" data-col="code" />
      </td>
      <td class="px-2 py-1">
        <input type="text"
               class="sample-dil w-full border border-transparent rounded px-2 py-1
                      text-xs focus:outline-none focus:border-indigo-400 focus:bg-white
                      bg-transparent"
               placeholder="Ex: SM;10;100"
               data-row="${i}" data-col="dil" />
      </td>
    `;
    tbody.appendChild(tr);
  }

  // ── Événements du tableau ──

  // Clic sur le numéro de ligne → sélection
  tbody.querySelectorAll('.table-row-num').forEach(td => {
    td.addEventListener('mousedown', e => {
      const rowIdx = parseInt(td.closest('tr').dataset.row, 10);
      handleRowNumClick(e, rowIdx);
    });
  });

  // Focus sur un input → cellule active
  tbody.querySelectorAll('input').forEach(input => {
    input.addEventListener('focus', () => {
      _activeRow = parseInt(input.dataset.row, 10);
      syncRowStyles();
    });
  });

  // Navigation clavier dans le tableau
  tbody.addEventListener('keydown', handleTableKeydown);
  tbody.addEventListener('paste',   handlePaste);

  table.classList.remove('hidden');
  hint.classList.add('hidden');
  confirm.disabled = false;

  activateCell(1, 'code');
}

// ── Navigation / raccourcis clavier ──────────────────────────────────────────

function handleTableKeydown(e) {
  const input = e.target;
  if (!input.matches('.sample-code, .sample-dil')) return;

  const rowIdx = parseInt(input.dataset.row, 10);
  const col    = input.dataset.col; // 'code' | 'dil'
  const n      = totalRows();

  // ── Ctrl+D : fill down ──────────────────────────────────────────────────
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    e.preventDefault();
    if (_selectedRows.size < 2) return;
    const sorted = [..._selectedRows].sort((a, b) => a - b);
    const firstRow = document.querySelector(
      `#add-samples-tbody tr[data-row="${sorted[0]}"]`
    );
    const srcCode = firstRow?.querySelector('.sample-code')?.value || '';
    const srcDil  = firstRow?.querySelector('.sample-dil')?.value  || '';

    sorted.slice(1).forEach(i => {
      const tr = getRow(i);
      if (!tr) return;
      const ci = tr.querySelector('.sample-code');
      const di = tr.querySelector('.sample-dil');
      if (ci) ci.value = srcCode;
      if (di) di.value = srcDil;
    });
    return;
  }

  // ── Ctrl+A : sélectionner toutes les lignes ─────────────────────────────
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    e.preventDefault();
    for (let i = 1; i <= n; i++) _selectedRows.add(i);
    syncRowStyles();
    return;
  }

  // ── Suppr / Backspace (hors champ non vide) : effacer la sélection ──────
  if ((e.key === 'Delete' || e.key === 'Backspace') && _selectedRows.size > 1) {
    // N'interférer que si plusieurs lignes sélectionnées
    e.preventDefault();
    _selectedRows.forEach(i => {
      const tr = getRow(i);
      if (!tr) return;
      const ci = tr.querySelector('.sample-code');
      const di = tr.querySelector('.sample-dil');
      if (ci) ci.value = '';
      if (di) di.value = '';
    });
    return;
  }

  // ── Entrée → incrément + descendre ─────────────────────────────────────
  if (e.key === 'Enter') {
    e.preventDefault();
    if (col === 'code' && input.value && rowIdx < n) {
      const nextInput = document.querySelector(
        `#add-samples-tbody tr[data-row="${rowIdx + 1}"] .sample-code`
      );
      if (nextInput && !nextInput.value) {
        nextInput.value = incrementCode(input.value);
      }
    }
    if (rowIdx < n) activateCell(rowIdx + 1, col);
    return;
  }

  // ── Flèche bas → descendre (+ incrément si code vide en dessous) ────────
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (col === 'code' && input.value && rowIdx < n) {
      const nextInput = document.querySelector(
        `#add-samples-tbody tr[data-row="${rowIdx + 1}"] .sample-code`
      );
      if (nextInput && !nextInput.value) {
        nextInput.value = incrementCode(input.value);
      }
    }
    if (rowIdx < n) activateCell(rowIdx + 1, col);
    return;
  }

  // ── Flèche haut ─────────────────────────────────────────────────────────
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (rowIdx > 1) activateCell(rowIdx - 1, col);
    return;
  }

  // ── Tab : code → dil → code ligne suivante ──────────────────────────────
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    if (col === 'code') {
      activateCell(rowIdx, 'dil');
    } else if (rowIdx < n) {
      activateCell(rowIdx + 1, 'code');
    }
    return;
  }
  if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault();
    if (col === 'dil') {
      activateCell(rowIdx, 'code');
    } else if (rowIdx > 1) {
      activateCell(rowIdx - 1, 'dil');
    }
    return;
  }
}

// ── Copier-coller multi-lignes depuis Excel ───────────────────────────────────

function handlePaste(e) {
  const target = e.target;
  if (!target.matches('.sample-code, .sample-dil')) return;

  const text  = (e.clipboardData || window.clipboardData).getData('text');
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length <= 1) return;

  e.preventDefault();

  const startRow  = parseInt(target.dataset.row, 10);
  const isCodeCol = target.classList.contains('sample-code');
  const tbody     = document.getElementById('add-samples-tbody');

  lines.forEach((line, idx) => {
    const rowIdx  = startRow + idx;
    const cells   = line.split('\t');
    const codeVal = cells[0]?.trim() || '';
    const dilVal  = cells[1]?.trim() || '';

    const codeInput = tbody.querySelector(`.sample-code[data-row="${rowIdx}"]`);
    const dilInput  = tbody.querySelector(`.sample-dil[data-row="${rowIdx}"]`);

    if (isCodeCol) {
      if (codeInput) codeInput.value = codeVal;
      if (dilVal && dilInput) dilInput.value = dilVal;
    } else {
      if (dilInput) dilInput.value = codeVal;
    }
  });
}

// ── Collecte et validation ────────────────────────────────────────────────────

function collectSamples(programme, amorcesStr) {
  const tbody   = document.getElementById('add-samples-tbody');
  const rows    = tbody.querySelectorAll('tr');
  const samples = [];

  rows.forEach(tr => {
    const codeInput = tr.querySelector('.sample-code');
    const dilInput  = tr.querySelector('.sample-dil');
    const code   = codeInput?.value.trim() || '';
    const dilRaw = dilInput?.value.trim()  || '';

    if (!code) return;

    const dilutions = dilRaw
      ? dilRaw.split(';').map(d => d.trim()).filter(Boolean)
      : [''];

    dilutions.forEach((dil, dIdx) => {
      const instance = dilutions.length > 1 ? String(dIdx + 1) : '1';
      samples.push({
        content:   makeContent(code, instance, dil),
        code_labo: code,
        amorces:   amorcesStr,
        programme: programme,
        dilution:  dil || '',
        instance:  instance,
        is_blank:  false,
      });
    });
  });

  return samples;
}

// ── Init modale ───────────────────────────────────────────────────────────────

export async function initAddSamplesModal() {
  const modal       = document.getElementById('add-samples-modal');
  const btnOpen     = document.getElementById('btn-add-samples');
  const btnCancel   = document.getElementById('add-samples-cancel');
  const btnGenerate = document.getElementById('add-samples-generate');
  const btnConfirm  = document.getElementById('add-samples-confirm');
  const selProg     = document.getElementById('add-samples-programme');
  const errEl       = document.getElementById('add-samples-error');

  const [progs, couples] = await Promise.all([loadProgrammes(), loadCouples()]);

  progs.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.programme_name;
    opt.textContent = p.programme_name;
    selProg.appendChild(opt);
  });

  initCouplesPicker(couples);

  // ── Ouverture / fermeture ───────────────────────────────────────────────

  function openModal() {
    errEl.classList.add('hidden');
    modal.classList.remove('hidden');
    document.getElementById('add-samples-count').value = 1;
    document.getElementById('add-samples-table').classList.add('hidden');
    document.getElementById('add-samples-hint').classList.remove('hidden');
    document.getElementById('add-samples-tbody').innerHTML = '';
    document.getElementById('add-samples-confirm').disabled = true;
    selProg.value = '';
    resetCouplesPicker();
    _activeRow = null;
    _selectedRows.clear();
  }

  function closeModal() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    modal.classList.add('hidden');
  }

  btnOpen.addEventListener('click', openModal);
  btnCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  // ── Générer ─────────────────────────────────────────────────────────────

  btnGenerate.addEventListener('click', () => {
    const n = parseInt(document.getElementById('add-samples-count').value, 10);
    if (!n || n < 1) return;
    generateTable(Math.min(n, 500));
  });

  document.getElementById('add-samples-count').addEventListener('keydown', e => {
    if (e.key === 'Enter') btnGenerate.click();
  });

  // ── Confirmer ──────────────────────────────────────────────────────────

  btnConfirm.addEventListener('click', () => {
    errEl.classList.add('hidden');

    const programme = selProg.value;
    if (!programme) {
      errEl.textContent = 'Veuillez choisir un programme PCR.';
      errEl.classList.remove('hidden');
      return;
    }

    const amorcesStr = [..._selectedCouples].join(' / ');
    const samples    = collectSamples(programme, amorcesStr);

    if (samples.length === 0) {
      errEl.textContent = 'Aucun code labo saisi.';
      errEl.classList.remove('hidden');
      return;
    }

    pushState();
    samples.forEach(s => _unplacedItems.push(s));
    renderAll();
    closeModal();
    toast(`${samples.length} échantillon${samples.length > 1 ? 's' : ''} ajouté${samples.length > 1 ? 's' : ''} aux non-assignés.`);
  });
}
