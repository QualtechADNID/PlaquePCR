/**
 * index.js — Interactions de la page d'accueil (upload, drag & drop fichier)
 *
 * Chargé après jQuery (CDN). Pas de module ES6 ici car jQuery ne supporte pas
 * l'import natif sans bundler.
 */
(function () {
  const $file  = $('#file');
  const $drop  = $('#drop-area');
  const $info  = $('#file-info');
  const $name  = $('#fi-name');
  const $size  = $('#fi-size');
  const $type  = $('#fi-type');
  const $alert = $('#alert');
  const $reset = $('#reset-btn');

  // Empêcher l'ouverture du fichier par le navigateur
  $(document).on('dragover dragenter drop', function (e) { e.preventDefault(); });

  // Effets visuels
  $drop.on('dragover dragenter', function () {
    $drop.addClass('border-indigo-500 bg-indigo-50');
  });
  $drop.on('dragleave dragend mouseleave', function () {
    $drop.removeClass('border-indigo-500 bg-indigo-50');
  });

  // Drag & drop → renseigne réellement l'input file
  $drop.on('drop', function (e) {
    const files = e.originalEvent.dataTransfer.files;
    if (files && files.length) {
      const f = files[0];
      if (!/\.(xls|xlsx)$/i.test(f.name)) {
        showError("Format non supporté. Extensions acceptées : .xls, .xlsx");
        $file.val('');
        $info.addClass('hidden');
      } else {
        const dt = new DataTransfer();
        dt.items.add(f);
        $file[0].files = dt.files;
        setFile(f);
      }
    }
    $drop.removeClass('border-indigo-500 bg-indigo-50');
  });

  // Sélection via clic
  $file.on('change', function (e) {
    const f = e.target.files && e.target.files[0];
    if (f) {
      if (!/\.(xls|xlsx)$/i.test(f.name)) {
        showError("Format non supporté. Extensions acceptées : .xls, .xlsx");
        $file.val('');
        $info.addClass('hidden');
      } else {
        setFile(f);
      }
    }
  });

  // Réinitialisation
  $reset.on('click', function () {
    $file.val('');
    $info.addClass('hidden');
    $alert.addClass('hidden').text('');
    $('#lv-file').val('');
    $('#lv-file-name').addClass('hidden').text('');
    $('#lv-clear').addClass('hidden');
  });

  // Fichier LV : afficher le nom
  $('#lv-file').on('change', function () {
    const f = this.files && this.files[0];
    if (f) {
      $('#lv-file-name').text(f.name).removeClass('hidden');
      $('#lv-clear').removeClass('hidden');
    }
  });
  $('#lv-clear').on('click', function () {
    $('#lv-file').val('');
    $('#lv-file-name').addClass('hidden').text('');
    $(this).addClass('hidden');
  });

  // Helpers
  function setFile(f) {
    $name.text(f.name);
    $size.text(formatSize(f.size));
    $type.text(f.type || 'Inconnu');
    $info.removeClass('hidden');
    $alert.addClass('hidden').text('');
  }

  function showError(msg) {
    $alert.text(msg).removeClass('hidden');
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '—';
    const k = 1024, units = ['octets', 'Ko', 'Mo', 'Go', 'To'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const v = (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1);
    return `${v} ${units[i]}`;
  }
})();
