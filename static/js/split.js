/**
 * split.js — Séparation du programme actif par amorces atomiques
 *
 * Dépendances : state.js, utils.js (ROWS, toast), render.js (renderAll)
 */

import { currentLayout } from './state.js';
import { ROWS, toast } from './utils.js';
import { renderAll } from './render.js';

/**
 * Sépare le programme `progIdx` en autant de plaques qu'il y a d'amorces atomiques
 * distinctes, en alignant les échantillons multi-amorces sur la même position.
 */
export function splitByAmorces(progIdx) {
  const prog = currentLayout.programmes[progIdx];
  if (!prog) return;

  // ── 1. Collecter tous les puits ──────────────────────────────────────────────
  const allWells = [];
  prog.plates.forEach(plate => {
    Object.values(plate.wells).forEach(wellData => {
      if (!wellData || !wellData.amorces || !wellData.code_labo) return;
      allWells.push(wellData);
    });
  });

  if (allWells.length === 0) { toast('Aucun puits à séparer.'); return; }

  // ── 2. Amorces atomiques distinctes ─────────────────────────────────────────
  const amorcesAtomiquesSet = new Set();
  allWells.forEach(w => {
    w.amorces.split(';').map(a => a.trim()).filter(Boolean).forEach(a => {
      amorcesAtomiquesSet.add(a);
    });
  });
  const amorcesAtomiques = [...amorcesAtomiquesSet];
  if (amorcesAtomiques.length <= 1) {
    toast('Une seule amorce présente — rien à séparer.');
    return;
  }

  // ── 3. Groupes d'amorces et rareté ──────────────────────────────────────────
  function normalizeGroupe(amorcesStr) {
    return amorcesStr.split(';').map(a => a.trim()).filter(Boolean).sort().join('|');
  }

  const groupeCount = {};
  allWells.forEach(w => {
    const g = normalizeGroupe(w.amorces);
    groupeCount[g] = (groupeCount[g] || 0) + 1;
  });

  const allGroupes = Object.keys(groupeCount);
  const maxCount = Math.max(...Object.values(groupeCount));
  const seuilRare = Math.max(2, Math.floor(maxCount * 0.10));

  const groupesCommuns = allGroupes.filter(g => groupeCount[g] > seuilRare);
  const groupesRares   = allGroupes.filter(g => groupeCount[g] <= seuilRare);

  function sortGroupes(arr) {
    return [...arr].sort((a, b) => {
      const diff = groupeCount[b] - groupeCount[a];
      return diff !== 0 ? diff : a.localeCompare(b);
    });
  }
  const ordreGroupes = [...sortGroupes(groupesCommuns), ...sortGroupes(groupesRares)];

  // ── 4. Tri intra-groupe ──────────────────────────────────────────────────────
  function cmpWells(a, b) {
    const dA = a.facteur_dilution != null ? String(a.facteur_dilution) : '';
    const dB = b.facteur_dilution != null ? String(b.facteur_dilution) : '';
    const dAn = parseFloat(dA), dBn = parseFloat(dB);
    if (!isNaN(dAn) && !isNaN(dBn) && dAn !== dBn) return dAn - dBn;
    const dcmp = dA.localeCompare(dB);
    if (dcmp !== 0) return dcmp;
    const clA = a.code_labo || '', clB = b.code_labo || '';
    const clcmp = clA.localeCompare(clB);
    if (clcmp !== 0) return clcmp;
    const iA = a.instance != null ? String(a.instance) : '';
    const iB = b.instance != null ? String(b.instance) : '';
    const iAn = parseFloat(iA), iBn = parseFloat(iB);
    if (!isNaN(iAn) && !isNaN(iBn)) return iAn - iBn;
    return iA.localeCompare(iB);
  }

  const wellsParGroupe = {};
  ordreGroupes.forEach(g => { wellsParGroupe[g] = []; });
  allWells.forEach(w => { wellsParGroupe[normalizeGroupe(w.amorces)].push(w); });
  ordreGroupes.forEach(g => { wellsParGroupe[g].sort(cmpWells); });

  // ── 5. Positions globales (alignement inter-plaques) ─────────────────────────
  function* colPositionGen() {
    for (let c = 1; c <= 12; c++) {
      for (const r of ROWS) {
        yield r + String(c).padStart(2, '0');
      }
    }
  }
  const posGen = colPositionGen();

  function sampleKey(w) {
    return (
      (w.code_labo || '') + '||' +
      (w.instance != null ? String(w.instance) : '') + '||' +
      (w.facteur_dilution != null ? String(w.facteur_dilution) : '')
    );
  }

  const samplePosition = {};
  ordreGroupes.forEach(groupe => {
    wellsParGroupe[groupe].forEach(w => {
      const sk = sampleKey(w);
      if (!(sk in samplePosition)) {
        const next = posGen.next();
        if (!next.done) samplePosition[sk] = next.value;
      }
    });
  });

  // ── 6. Popularité des amorces et ordre des plaques ───────────────────────────
  const amorcePop = {};
  allWells.forEach(w => {
    w.amorces.split(';').map(a => a.trim()).filter(Boolean).forEach(a => {
      amorcePop[a] = (amorcePop[a] || 0) + 1;
    });
  });

  const maxAmorcePop = Math.max(...Object.values(amorcePop));
  const seuilAmorceRare = Math.max(2, Math.floor(maxAmorcePop * 0.10));

  const amorcesCommunes = amorcesAtomiques.filter(a => amorcePop[a] > seuilAmorceRare);
  const amorcesRares    = amorcesAtomiques.filter(a => amorcePop[a] <= seuilAmorceRare);

  function sortAmorces(arr) {
    return [...arr].sort((a, b) => {
      const diff = amorcePop[b] - amorcePop[a];
      return diff !== 0 ? diff : a.localeCompare(b);
    });
  }

  const amorcesOrdonnees = [...sortAmorces(amorcesCommunes), ...sortAmorces(amorcesRares)];

  // ── 7. Construire les plaques ────────────────────────────────────────────────
  const newPlates = amorcesOrdonnees.map((amorce, i) => {
    const wells = {};
    allWells.forEach(w => {
      const atomiques = w.amorces.split(';').map(a => a.trim()).filter(Boolean);
      if (!atomiques.includes(amorce)) return;
      const sk  = sampleKey(w);
      const pos = samplePosition[sk];
      if (pos) wells[pos] = w;
    });
    return { plate_nbr: i + 1, amorce_label: amorce, wells };
  });

  prog.plates = newPlates;
  renderAll();

  const nbRares = amorcesRares.length;
  const rareMsg = nbRares > 0
    ? ` (${nbRares} amorce${nbRares > 1 ? 's' : ''} rare${nbRares > 1 ? 's' : ''} en fin)`
    : '';
  toast(`Programme séparé en ${newPlates.length} plaque(s) par amorce${rareMsg}.`);
}
