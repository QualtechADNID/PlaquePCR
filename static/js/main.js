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
import { initGroupingPanel } from './groups.js';
import { toast } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {

  // ── Groupement de demandes ─────────────────────────────────────────────────
  initGroupingPanel();

  // ── Bouton "Séparer par amorces" (délégation depuis prog-tabs) ────────────
  document.getElementById('prog-tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="split-amorces"]');
    if (btn) splitByAmorces(state.activeProgIdx);
  });

  // ── Zone "Puits non assignés" (drop pour retirer un échantillon) ───────────
  const unplacedZone = document.getElementById('unplaced-container');
  unplacedZone.addEventListener('dragover', e => {
    e.preventDefault();
    unplacedZone.classList.add('bg-yellow-50');
  });
  unplacedZone.addEventListener('dragleave', () => unplacedZone.classList.remove('bg-yellow-50'));
  unplacedZone.addEventListener('drop', e => {
    e.preventDefault();
    unplacedZone.classList.remove('bg-yellow-50');
    if (!dragSource || dragSource.type !== 'plate') return;
    removeSampleFromPlate(dragSource.prog, dragSource.plate, dragSource.well);
    state._unplacedItems.push(dragSource.data);
    renderAll();
    toast('Échantillon retiré de la plaque.');
  });

  // ── Touche Escape → désélectionner ────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') clearSelection();
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

  // ── Premier rendu ──────────────────────────────────────────────────────────
  renderAll();
});
