/**
 * groups.js — Panneau de groupement des demandes
 *
 * Dépendances : state.js, utils.js (toast), render.js (renderAll)
 * Les données Flask (INITIAL_DEMANDES, DEMANDE_CLIENTS) sont lues depuis window.*
 */

import { currentLayout, setCurrentLayout, setActiveProgIdx, setUnplacedItems } from './state.js';
import { toast } from './utils.js';
import { renderAll } from './render.js';

// ── État local au panneau ─────────────────────────────────────────────────────

let availableDemandes = [...window.INITIAL_DEMANDES];
let groupCounter = 0;
let groupsList = []; // [{ id, name, demandes: [] }]
let chipDragSource = null; // { demande, fromGroupId: string|null }

// ── Chip ──────────────────────────────────────────────────────────────────────

function createChip(demande, groupId) {
  const chip = document.createElement('span');
  chip.className = 'demande-chip';
  chip.setAttribute('draggable', 'true');
  chip.dataset.demande = demande;

  const clientName =
    window.DEMANDE_CLIENTS[demande] ||
    window.DEMANDE_CLIENTS[demande.trim()] ||
    null;

  const inner = document.createElement('span');
  inner.className = 'flex flex-col leading-tight';
  const idSpan = document.createElement('span');
  idSpan.textContent = demande.trim();
  inner.appendChild(idSpan);

  if (clientName) {
    const clientSpan = document.createElement('span');
    clientSpan.className = 'font-normal text-indigo-400';
    clientSpan.style.fontSize = '0.58rem';
    const truncated = clientName.length > 20 ? clientName.slice(0, 20) + '…' : clientName;
    clientSpan.textContent = truncated;
    if (clientName.length > 20) clientSpan.title = clientName;
    inner.appendChild(clientSpan);
  }
  chip.appendChild(inner);

  if (groupId !== null) {
    const btn = document.createElement('span');
    btn.className = 'chip-remove';
    btn.textContent = '✕';
    btn.title = 'Retirer du groupe';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeDemandeFromGroup(demande, groupId);
    });
    chip.appendChild(btn);
  }

  chip.addEventListener('dragstart', e => {
    chipDragSource = { demande, fromGroupId: groupId };
    chip.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  chip.addEventListener('dragend', () => {
    chip.classList.remove('dragging');
    chipDragSource = null;
  });

  return chip;
}

// ── Rendu du panneau ──────────────────────────────────────────────────────────

function renderAvailableChips() {
  const container = document.getElementById('available-chips');
  container.innerHTML = '';
  if (availableDemandes.length === 0) {
    container.innerHTML = '<span class="text-xs text-gray-400 italic">Aucune demande disponible</span>';
  } else {
    availableDemandes.forEach(d => container.appendChild(createChip(d, null)));
  }
}

function renderGroupsList() {
  const container = document.getElementById('groups-list');
  container.innerHTML = '';

  groupsList.forEach(group => {
    const box = document.createElement('div');
    box.className = 'group-box';
    box.dataset.groupId = group.id;

    // Header
    const header = document.createElement('div');
    header.className = 'group-header';

    const nameEl = document.createElement('span');
    nameEl.className = 'group-name';
    nameEl.contentEditable = 'true';
    nameEl.spellcheck = false;
    nameEl.textContent = group.name;
    nameEl.title = 'Cliquer pour renommer';
    nameEl.addEventListener('input', () => {
      group.name = nameEl.textContent.trim() || group.name;
    });
    nameEl.addEventListener('blur', () => { nameEl.textContent = group.name; });
    nameEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    });

    const removeGroupBtn = document.createElement('button');
    removeGroupBtn.className = 'text-xs text-gray-400 hover:text-red-500 ml-2 flex-shrink-0';
    removeGroupBtn.textContent = '✕';
    removeGroupBtn.title = 'Supprimer ce groupe';
    removeGroupBtn.addEventListener('click', () => deleteGroup(group.id));

    header.appendChild(nameEl);
    header.appendChild(removeGroupBtn);
    box.appendChild(header);

    // Chips
    const chipsArea = document.createElement('div');
    chipsArea.className = 'group-chips';
    if (group.demandes.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'group-empty-hint';
      hint.textContent = 'Déposer des demandes ici';
      chipsArea.appendChild(hint);
    } else {
      group.demandes.forEach(d => chipsArea.appendChild(createChip(d, group.id)));
    }
    box.appendChild(chipsArea);

    // Drop zone sur le groupe
    box.addEventListener('dragover', e => {
      if (chipDragSource) { e.preventDefault(); box.classList.add('drag-over'); }
    });
    box.addEventListener('dragleave', () => box.classList.remove('drag-over'));
    box.addEventListener('drop', e => {
      e.preventDefault();
      box.classList.remove('drag-over');
      if (!chipDragSource) return;
      const { demande, fromGroupId } = chipDragSource;
      if (fromGroupId === group.id) return;
      if (fromGroupId === null) {
        availableDemandes = availableDemandes.filter(d => d !== demande);
      } else {
        const src = groupsList.find(g => g.id === fromGroupId);
        if (src) src.demandes = src.demandes.filter(d => d !== demande);
      }
      if (!group.demandes.includes(demande)) group.demandes.push(demande);
      renderGroupingPanel();
    });

    container.appendChild(box);
  });
}

export function renderGroupingPanel() {
  renderAvailableChips();
  renderGroupsList();
}

// ── Actions ───────────────────────────────────────────────────────────────────

function removeDemandeFromGroup(demande, groupId) {
  const group = groupsList.find(g => g.id === groupId);
  if (!group) return;
  group.demandes = group.demandes.filter(d => d !== demande);
  if (!availableDemandes.includes(demande)) {
    availableDemandes.push(demande);
    availableDemandes.sort();
  }
  renderGroupingPanel();
}

function deleteGroup(groupId) {
  const group = groupsList.find(g => g.id === groupId);
  if (group) {
    group.demandes.forEach(d => {
      if (!availableDemandes.includes(d)) availableDemandes.push(d);
    });
    availableDemandes.sort();
  }
  groupsList = groupsList.filter(g => g.id !== groupId);
  renderGroupingPanel();
}

// ── Branchement des événements (appelé depuis main.js) ────────────────────────

export function initGroupingPanel() {
  // Drop zone "Disponibles"
  const availEl = document.getElementById('available-chips');
  availEl.addEventListener('dragover', e => {
    if (chipDragSource && chipDragSource.fromGroupId !== null) {
      e.preventDefault();
      availEl.style.background = '#ede9fe';
    }
  });
  availEl.addEventListener('dragleave', () => { availEl.style.background = ''; });
  availEl.addEventListener('drop', e => {
    e.preventDefault();
    availEl.style.background = '';
    if (!chipDragSource || chipDragSource.fromGroupId === null) return;
    removeDemandeFromGroup(chipDragSource.demande, chipDragSource.fromGroupId);
  });

  // Nouveau groupe
  document.getElementById('btn-new-group').addEventListener('click', () => {
    groupCounter++;
    groupsList.push({ id: `g${groupCounter}`, name: `Groupe ${groupCounter}`, demandes: [] });
    renderGroupingPanel();
  });

  // Auto-grouper par client
  document.getElementById('btn-auto-group').addEventListener('click', () => {
    if (Object.keys(window.DEMANDE_CLIENTS).length === 0) {
      toast("Aucune donnée client disponible. Chargez un fichier LV depuis la page d'accueil.");
      return;
    }

    const allDemandes = [
      ...availableDemandes,
      ...groupsList.flatMap(g => g.demandes),
    ];
    const uniqueDemandes = [...new Set(allDemandes)];

    const clientGroups = {};
    const unmapped = [];
    uniqueDemandes.forEach(d => {
      const client =
        window.DEMANDE_CLIENTS[d] ||
        window.DEMANDE_CLIENTS[d.trim()] ||
        null;
      if (client) {
        if (!clientGroups[client]) clientGroups[client] = [];
        clientGroups[client].push(d);
      } else {
        unmapped.push(d);
      }
    });

    if (Object.keys(clientGroups).length === 0) {
      toast("Aucune demande n'a pu être associée à un client.");
      return;
    }

    groupsList = [];
    Object.entries(clientGroups).forEach(([clientName, demandes]) => {
      groupCounter++;
      groupsList.push({ id: `g${groupCounter}`, name: clientName, demandes });
    });
    availableDemandes = unmapped;

    renderGroupingPanel();
    toast(`${Object.keys(clientGroups).length} groupe(s) créé(s) automatiquement.`);
  });

  // Appliquer les groupes
  document.getElementById('btn-apply-groups').addEventListener('click', async () => {
    const activeGroups = groupsList.filter(g => g.demandes.length > 0);
    if (activeGroups.length === 0) {
      toast('Ajoutez des demandes dans au moins un groupe.');
      return;
    }

    const groups = {};
    activeGroups.forEach(g => { groups[g.name] = g.demandes; });

    const btn = document.getElementById('btn-apply-groups');
    btn.disabled = true;
    btn.textContent = 'Calcul…';

    try {
      const resp = await fetch('/regroup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        toast('Erreur : ' + (err.error || 'inconnue'));
        return;
      }

      const newLayout = await resp.json();
      if (!newLayout.programmes || newLayout.programmes.length === 0) {
        toast('Aucun échantillon trouvé pour ces groupes.');
        return;
      }

      setCurrentLayout(newLayout);
      setActiveProgIdx(0);
      setUnplacedItems([]);
      renderAll();
      toast(`Groupes appliqués — ${newLayout.programmes.length} programme(s).`);
    } catch (e) {
      toast('Erreur réseau : ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Appliquer les groupes';
    }
  });

  // Rendu initial
  renderGroupingPanel();
}
