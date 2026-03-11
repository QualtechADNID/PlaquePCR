/**
 * main.js — Point d'entrée de l'application
 *
 * Branche tous les événements globaux et lance le premier rendu.
 * Les données Flask sont disponibles via window.* (injectées dans le template).
 */

import * as state from './state.js';
import { renderAll } from './render.js';
import { clearSelection } from './selection.js';
import { dragSource, removeSampleFromPlate } from './dragdrop.js';
import { splitByAmorces } from './split.js';
import { initGroupingPanel, renderGroupingPanel } from './groups.js';
import { toast } from './utils.js';
import { attachSaveButton } from './save.js';
import { initAddSamplesModal } from './add-samples.js';
import { setHistoryRenderCallback, undo, redo, canUndo, canRedo, undoCount, redoCount } from './history.js';
import { setClipboardRenderCallback, cut, paste, cancelCut, hasClipboard } from './clipboard.js';
import { pushState } from './history.js';
import { endDragSelect, selectedWells, selectedUnplaced, parseSelKey, selectAllOnPlate } from './selection.js';
import { hoveredPlate } from './render.js';

document.addEventListener('DOMContentLoaded', async () => {

  // ── Brancher les callbacks history et clipboard ───────────────────────────
  setHistoryRenderCallback(renderAll);

  // Wrapper renderAll pour mettre à jour la classe paste-mode sur body
  function renderAllWithPasteMode() {
    renderAll();
    document.body.classList.toggle('paste-mode', hasClipboard());
  }
  setClipboardRenderCallback(renderAllWithPasteMode);

  // ── Groupement de demandes ─────────────────────────────────────────────────
  initGroupingPanel();

  // ── Sauvegarde du plan ────────────────────────────────────────────────────
  attachSaveButton();

  // ── Modale "Ajouter des échantillons" ─────────────────────────────────────
  await initAddSamplesModal();

  // ── Boutons Annuler / Rétablir ────────────────────────────────────────────
  const btnUndo      = document.getElementById('btn-undo');
  const btnRedo      = document.getElementById('btn-redo');
  const btnUndoLabel = document.getElementById('btn-undo-label');
  const btnRedoLabel = document.getElementById('btn-redo-label');

  function updateHistoryButtons({ undoCount: u, redoCount: r } = {}) {
    const uCount = u ?? undoCount();
    const rCount = r ?? redoCount();
    btnUndo.disabled = uCount === 0;
    btnRedo.disabled = rCount === 0;
    btnUndoLabel.textContent = uCount > 0 ? `Annuler (${uCount})` : 'Annuler';
    btnRedoLabel.textContent = rCount > 0 ? `Rétablir (${rCount})` : 'Rétablir';
  }

  document.addEventListener('history-change', e => updateHistoryButtons(e.detail));
  updateHistoryButtons();

  btnUndo.addEventListener('click', () => {
    if (undo()) toast('Annulation effectuée.');
  });
  btnRedo.addEventListener('click', () => {
    if (redo()) toast('Rétablissement effectué.');
  });

  // ── Bouton "Séparer par amorces" (délégation depuis prog-tabs) ────────────
  document.getElementById('prog-tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="split-amorces"]');
    if (btn) splitByAmorces(state.activeProgIdx);
  });

  // ── Zone "Puits non assignés" (drop pour retirer un échantillon) ───────────
  const unplacedZone = document.getElementById('unplaced-container');
  unplacedZone.addEventListener('dragover', e => {
    e.preventDefault();
    unplacedZone.classList.add('drag-target');
  });
  unplacedZone.addEventListener('dragleave', () => unplacedZone.classList.remove('drag-target'));
  unplacedZone.addEventListener('drop', e => {
    e.preventDefault();
    unplacedZone.classList.remove('drag-target');
    if (!dragSource || dragSource.type !== 'plate') return;

    pushState();

    if (selectedWells.size > 1) {
      // Déplacer tous les puits sélectionnés vers les non-assignés
      let count = 0;
      [...selectedWells].forEach(k => {
        const { progName, plateNbr, wKey } = parseSelKey(k);
        const data = state.currentLayout.programmes
          .find(p => p.name === progName)
          ?.plates.find(p => p.plate_nbr === plateNbr)
          ?.wells[wKey];
        if (data) {
          removeSampleFromPlate(progName, plateNbr, wKey);
          state._unplacedItems.push(data);
          count++;
        }
      });
      renderAll();
      toast(`${count} échantillon${count > 1 ? 's' : ''} retiré${count > 1 ? 's' : ''} de la plaque.`);
    } else {
      removeSampleFromPlate(dragSource.prog, dragSource.plate, dragSource.well);
      state._unplacedItems.push(dragSource.data);
      renderAll();
      toast('Échantillon retiré de la plaque.');
    }
  });

  // ── Menu contextuel (clic droit sur un puits) ─────────────────────────────
  const ctxMenu        = document.getElementById('well-context-menu');
  const ctxAddBlank    = document.getElementById('ctx-add-blank');
  const ctxRemoveBlank = document.getElementById('ctx-remove-blank');
  const blankModal     = document.getElementById('blank-modal');
  const blankInput     = document.getElementById('blank-name-input');

  // État du contexte courant (puits sur lequel on a fait clic droit)
  let ctxTarget = null; // { progName, plateNbr, wKey, wellData }

  function hideCtxMenu() {
    ctxMenu.classList.add('hidden');
    ctxTarget = null;
  }

  // Délégation sur la zone principale pour intercepter le clic droit sur les puits
  document.getElementById('prog-panels').addEventListener('contextmenu', e => {
    const wellEl = e.target.closest('.well');
    if (!wellEl) { hideCtxMenu(); return; }

    e.preventDefault();

    const progName  = wellEl.dataset.prog;
    const plateNbr  = parseInt(wellEl.dataset.plate, 10);
    const wKey      = wellEl.dataset.well;
    const wellData  = wellEl.dataset.wellData ? JSON.parse(wellEl.dataset.wellData) : null;

    ctxTarget = { progName, plateNbr, wKey, wellData };

    // Adapter les items visibles selon l'état du puits
    if (wellData && wellData.is_blank) {
      ctxAddBlank.classList.add('hidden');
      ctxRemoveBlank.classList.remove('hidden');
    } else if (!wellData) {
      ctxAddBlank.classList.remove('hidden');
      ctxRemoveBlank.classList.add('hidden');
    } else {
      // Puits occupé non-blanc : aucune option contextuelle utile pour l'instant
      hideCtxMenu();
      return;
    }

    // Positionner le menu
    ctxMenu.style.left = `${e.clientX}px`;
    ctxMenu.style.top  = `${e.clientY}px`;
    ctxMenu.classList.remove('hidden');
  });

  // Clic ailleurs → fermer le menu
  document.addEventListener('click', e => {
    if (!ctxMenu.contains(e.target)) hideCtxMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideCtxMenu();
  }, { capture: false });

  // "Ajouter un blanc" → ouvrir la modale
  ctxAddBlank.addEventListener('click', () => {
    const saved = ctxTarget; // sauvegarder avant hideCtxMenu qui remet ctxTarget à null
    hideCtxMenu();
    if (!saved) return;
    ctxTarget = saved; // restaurer pour que confirmAddBlank puisse l'utiliser
    blankInput.value = '';
    blankModal.classList.remove('hidden');
    blankInput.focus();
  });

  // "Supprimer le blanc" → retirer directement
  ctxRemoveBlank.addEventListener('click', () => {
    if (!ctxTarget) { hideCtxMenu(); return; }
    const { progName, plateNbr, wKey } = ctxTarget;
    pushState();
    const prog  = state.currentLayout.programmes.find(p => p.name === progName);
    const plate = prog?.plates.find(p => p.plate_nbr === plateNbr);
    if (plate) {
      delete plate.wells[wKey];
      renderAll();
      toast('Blanc supprimé.');
    }
    hideCtxMenu();
  });

  // Modale blanc — Annuler
  document.getElementById('blank-modal-cancel').addEventListener('click', () => {
    blankModal.classList.add('hidden');
  });

  // Modale blanc — Confirmer
  function confirmAddBlank() {
    const name = blankInput.value.trim() || 'Blanc';
    blankModal.classList.add('hidden');

    if (!ctxTarget) return;
    const { progName, plateNbr, wKey } = ctxTarget;

    pushState();
    const prog  = state.currentLayout.programmes.find(p => p.name === progName);
    const plate = prog?.plates.find(p => p.plate_nbr === plateNbr);
    if (plate) {
      plate.wells[wKey] = {
        content: name,
        code_labo: name,
        amorces: '',
        dilution: null,
        instance: null,
        programme: null,
        is_blank: true,
      };
      renderAll();
      toast(`Blanc "${name}" ajouté.`);
    }
    ctxTarget = null;
  }

  document.getElementById('blank-modal-confirm').addEventListener('click', confirmAddBlank);
  blankInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmAddBlank();
    if (e.key === 'Escape') blankModal.classList.add('hidden');
  });

  // ── Touche Escape → désélectionner + annuler cut ──────────────────────────
  document.addEventListener('keydown', e => {
    // Ne pas intercepter si on est dans un champ de saisie
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

    if (e.key === 'Escape') {
      clearSelection();
      cancelCut(); // retire aussi paste-mode via renderAllWithPasteMode
      document.body.classList.remove('paste-mode');
      return;
    }

    // Delete / Backspace → désassigner les puits sélectionnés (→ non assignés)
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const totalWells    = selectedWells.size;
      const totalUnplaced = selectedUnplaced.size;
      if (totalWells === 0 && totalUnplaced === 0) return;
      e.preventDefault();

      pushState();
      let count = 0;

      // Puits de plaque → non assignés
      if (totalWells > 0) {
        [...selectedWells].forEach(k => {
          const { progName, plateNbr, wKey } = parseSelKey(k);
          const data = state.currentLayout.programmes
            .find(p => p.name === progName)
            ?.plates.find(p => p.plate_nbr === plateNbr)
            ?.wells[wKey];
          if (data) {
            removeSampleFromPlate(progName, plateNbr, wKey);
            state._unplacedItems.push(data);
            count++;
          }
        });
      }

      // Items déjà non assignés → suppression définitive de la liste unplaced
      if (totalUnplaced > 0) {
        const indices = [...selectedUnplaced].sort((a, b) => b - a);
        indices.forEach(i => state._unplacedItems.splice(i, 1));
        count += totalUnplaced;
      }

      renderAll();
      clearSelection();
      if (totalWells > 0 && totalUnplaced === 0) {
        toast(`${count} échantillon${count > 1 ? 's' : ''} retiré${count > 1 ? 's' : ''} de la plaque.`);
      } else if (totalUnplaced > 0 && totalWells === 0) {
        toast(`${count} élément${count > 1 ? 's' : ''} supprimé${count > 1 ? 's' : ''} de la liste.`);
      } else {
        toast(`${count} élément${count > 1 ? 's' : ''} retirés.`);
      }
      return;
    }

    // Ctrl+A → sélectionner tous les puits occupés de la plaque survolée
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      if (hoveredPlate) {
        e.preventDefault();
        selectAllOnPlate(hoveredPlate.progName, hoveredPlate.plateNbr);
      }
      return;
    }

    // Undo / Redo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      if (undo()) toast('Annulation effectuée.');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
      e.preventDefault();
      if (redo()) toast('Rétablissement effectué.');
      return;
    }
    // Cut / Paste
    if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
      e.preventDefault();
      cut();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      e.preventDefault();
      paste();
      return;
    }
  });

  // ── Export Excel ───────────────────────────────────────────────────────────
  document.getElementById('btn-export').addEventListener('click', async () => {
    const btn = document.getElementById('btn-export');
    btn.disabled = true;
    btn.textContent = 'Génération…';

    // state.currentLayout est un live binding : il reflète toujours la valeur courante.
    try {
      const resp = await fetch('/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout: state.currentLayout,
          template_key: window.TEMPLATE_KEY,
          position: window.POSITION,
          filename: 'plaque',
        }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        toast('Erreur : ' + (err.error || 'inconnue'));
        return;
      }

      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = resp.headers.get('Content-Disposition')
        ?.split('filename=')[1]?.replace(/"/g, '') || 'plaque_PCR.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Fichier téléchargé !');
    } catch (e) {
      toast('Erreur réseau : ' + e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Exporter Excel`;
    }
  });

  // ── Fichier client (LV) ───────────────────────────────────────────────────
  const clientFileModal   = document.getElementById('client-file-modal');
  const clientFileInput   = document.getElementById('client-file-input');
  const clientFileError   = document.getElementById('client-file-error');
  const clientFileConfirm = document.getElementById('client-file-confirm');

  document.getElementById('btn-add-client-file').addEventListener('click', () => {
    clientFileInput.value = '';
    clientFileError.classList.add('hidden');
    clientFileConfirm.disabled = true;
    clientFileModal.classList.remove('hidden');
  });

  clientFileInput.addEventListener('change', () => {
    clientFileConfirm.disabled = !clientFileInput.files?.length;
    clientFileError.classList.add('hidden');
  });

  document.getElementById('client-file-cancel').addEventListener('click', () => {
    clientFileModal.classList.add('hidden');
  });

  clientFileConfirm.addEventListener('click', async () => {
    const file = clientFileInput.files?.[0];
    if (!file) return;

    clientFileConfirm.disabled = true;
    clientFileConfirm.textContent = 'Chargement…';

    const fd = new FormData();
    fd.append('lv_file', file);

    try {
      const resp = await fetch('/add-client-file', { method: 'POST', body: fd });
      const data = await resp.json();

      if (!resp.ok) {
        clientFileError.textContent = data.error || 'Erreur inconnue';
        clientFileError.classList.remove('hidden');
        return;
      }

      // Mettre à jour la map globale et re-rendre le panneau de groupement
      Object.assign(window.DEMANDE_CLIENTS, data.demande_clients);
      renderGroupingPanel();
      clientFileModal.classList.add('hidden');
      toast(`Fichier client chargé — ${Object.keys(data.demande_clients).length} demande(s) associées.`);
    } catch (e) {
      clientFileError.textContent = 'Erreur réseau : ' + e.message;
      clientFileError.classList.remove('hidden');
    } finally {
      clientFileConfirm.disabled = false;
      clientFileConfirm.textContent = 'Charger';
    }
  });

  // ── Nouveau fichier de données ─────────────────────────────────────────────
  const dataFileModal   = document.getElementById('data-file-modal');
  const dataFileInput   = document.getElementById('data-file-input');
  const dataFileError   = document.getElementById('data-file-error');
  const dataFileConfirm = document.getElementById('data-file-confirm');

  document.getElementById('btn-add-data-file').addEventListener('click', () => {
    dataFileInput.value = '';
    dataFileError.classList.add('hidden');
    dataFileConfirm.disabled = true;
    dataFileModal.classList.remove('hidden');
  });

  dataFileInput.addEventListener('change', () => {
    dataFileConfirm.disabled = !dataFileInput.files?.length;
    dataFileError.classList.add('hidden');
  });

  document.getElementById('data-file-cancel').addEventListener('click', () => {
    dataFileModal.classList.add('hidden');
  });

  dataFileConfirm.addEventListener('click', async () => {
    const file = dataFileInput.files?.[0];
    if (!file) return;

    dataFileConfirm.disabled = true;
    dataFileConfirm.textContent = 'Analyse…';

    const fd = new FormData();
    fd.append('excel_file', file);
    fd.append('layout_json', JSON.stringify(state.currentLayout));
    fd.append('unplaced_json', JSON.stringify(state._unplacedItems));
    fd.append('sort_similarity', 'true');
    fd.append('group_dilutions', 'false');

    try {
      const resp = await fetch('/add-data-file', { method: 'POST', body: fd });
      const data = await resp.json();

      if (!resp.ok) {
        dataFileError.textContent = data.error || 'Erreur inconnue';
        dataFileError.classList.remove('hidden');
        return;
      }

      dataFileModal.classList.add('hidden');

      if (data.mode === 'reset') {
        pushState();
        state.setCurrentLayout(data.layout);
        state.setUnplacedItems([]);
        renderAll();
        toast(`Plaque réinitialisée — ${data.new_count} échantillon(s) chargé(s).`);
      } else {
        // merge : ajouter les nouveaux échantillons aux puits non-assignés
        if (data.new_count === 0) {
          toast(`Aucun nouvel échantillon détecté (${data.existing_count} déjà présent(s)).`);
        } else {
          pushState();
          data.new_samples.forEach(s => state._unplacedItems.push(s));
          renderAll();
          toast(`${data.new_count} nouvel(s) échantillon(s) ajouté(s) aux puits non-assignés.`);
        }
      }
    } catch (e) {
      dataFileError.textContent = 'Erreur réseau : ' + e.message;
      dataFileError.classList.remove('hidden');
    } finally {
      dataFileConfirm.disabled = false;
      dataFileConfirm.textContent = 'Charger';
    }
  });

  // ── Fin du drag-select au relâchement de la souris ───────────────────────
  document.addEventListener('mouseup', () => endDragSelect());

  // ── Premier rendu ──────────────────────────────────────────────────────────
  renderAll();
});
