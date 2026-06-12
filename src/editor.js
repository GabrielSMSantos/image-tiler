// ══════════════════════════════════════════════════════════════════════════════
// Editor de Matriz v3 — SVG (inline DOM editing) + Raster (canvas flood-fill)
// ══════════════════════════════════════════════════════════════════════════════
(function editorInit() {

// ── DOM refs ──────────────────────────────────────────────────────────────────
var edCanvas     = document.getElementById('editorCanvas');
var edCtx        = edCanvas.getContext('2d');
var svgWrap      = document.getElementById('svgEditorWrap');
var svgPanel     = document.getElementById('svgColorPanel');
var tlDiv        = document.getElementById('textLayersDiv');
var galleryList  = document.getElementById('galleryList');
var statusBar    = document.getElementById('editorStatusBar');
var uploadModal  = document.getElementById('uploadModalOverlay');
var matrixInput  = document.getElementById('matrixFileInput');
var canvasArea   = document.getElementById('editorCanvasArea');
var editorStage  = document.getElementById('editorStage');
var stageInner   = document.getElementById('editorStageInner');
var textOverlay  = document.getElementById('textOverlayCanvas');
var tocCtx       = textOverlay.getContext('2d');

// ── State ─────────────────────────────────────────────────────────────────────
var st = {
  matrix:      null,    // { id, name, format, layers, svgContent, presetName, coordVersion }
  format:      null,    // 'svg' | 'raster'
  // Raster state
  baseData:    null,
  origData:    null,
  undoStack:   [],
  redoStack:   [],
  // SVG state
  svgDoc:      null,    // live DOM SVG element (inside svgWrap)
  svgHistory:  [],      // undo stack: array of SVG XML strings
  svgRedo:     [],
  svgImageEl:  null,    // <image> element when SVG is just a raster wrapper (no vector shapes)
  // Shared
  textLayers:  [],
  selText:     null,
  editingText: null,
  tool:        'color',
  pendingFile: null,
  // Stage / coordinate system
  natW: 0, natH: 0,        // natural dimensions (px) of current matrix
  displayScale: 1,          // current CSS transform scale
  zoomMode: 'fit',          // 'fit' | 'manual'
  zoomLevel: 1,              // used when zoomMode === 'manual'
};

var ZOOM_STEP = 0.1, ZOOM_MIN = 0.1, ZOOM_MAX = 4;

// ── Utils ─────────────────────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function log(msg, err) {
  if (statusBar) { statusBar.textContent = msg; statusBar.style.color = err ? 'var(--accent2)' : 'var(--accent)'; }
  console.log('[editor]', msg);
}
function hexToRgb(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }
function rgbToHex(r,g,b) { return '#'+('0'+r.toString(16)).slice(-2)+('0'+g.toString(16)).slice(-2)+('0'+b.toString(16)).slice(-2); }
function cloneImgData(src) { var d = edCtx.createImageData(src.width,src.height); d.data.set(src.data); return d; }

// ── Stage transform (single source of truth for display scale) ────────────────
function applyStageTransform() {
  if (!st.matrix || !st.natW || !st.natH) return;
  var fitScale = Math.min((canvasArea.clientWidth-48)/st.natW, (canvasArea.clientHeight-48)/st.natH, 1);
  st.displayScale = (st.zoomMode === 'manual') ? st.zoomLevel : fitScale;
  editorStage.style.width  = Math.round(st.natW * st.displayScale) + 'px';
  editorStage.style.height = Math.round(st.natH * st.displayScale) + 'px';
  stageInner.style.width  = st.natW + 'px';
  stageInner.style.height = st.natH + 'px';
  stageInner.style.transform = 'scale(' + st.displayScale + ')';
  updateZoomLabel();
}

var _stageRaf = null;
function scheduleStageTransform() {
  if (_stageRaf) return;
  _stageRaf = requestAnimationFrame(function() { _stageRaf = null; applyStageTransform(); });
}

function updateZoomLabel() {
  var lbl = document.getElementById('edZoomLabel');
  if (lbl) lbl.textContent = Math.round(st.displayScale * 100) + '%';
}

// ── Undo/Redo ─────────────────────────────────────────────────────────────────
function pushUndo() {
  if (st.format === 'svg') {
    if (!st.svgDoc) return;
    st.svgHistory.push(st.svgDoc.outerHTML);
    if (st.svgHistory.length > 30) st.svgHistory.shift();
    st.svgRedo = [];
  } else {
    if (!st.baseData) return;
    st.undoStack.push({
      baseData:    cloneImgData(st.baseData),
      colorLayers: JSON.parse(JSON.stringify(st.matrix.layers.filter(function(l){return l.type==='color';}))),
      textLayers:  JSON.parse(JSON.stringify(st.textLayers)),
    });
    if (st.undoStack.length > 30) st.undoStack.shift();
    st.redoStack = [];
  }
  updateUndoBtns();
}

function doUndo() {
  if (st.format === 'svg') {
    if (!st.svgHistory.length) return;
    st.svgRedo.push(st.svgDoc.outerHTML);
    var prev = st.svgHistory.pop();
    replaceSvgDOM(prev); saveSvg();
  } else {
    if (!st.undoStack.length) return;
    st.redoStack.push({ baseData: cloneImgData(st.baseData), colorLayers: JSON.parse(JSON.stringify(st.matrix.layers.filter(function(l){return l.type==='color';}))), textLayers: JSON.parse(JSON.stringify(st.textLayers)) });
    var snap = st.undoStack.pop();
    st.baseData = cloneImgData(snap.baseData);
    edCtx.putImageData(st.baseData, 0, 0);
    st.matrix.layers = snap.colorLayers.concat(snap.textLayers);
    st.textLayers = JSON.parse(JSON.stringify(snap.textLayers));
    rebuildTextDOM();
    window.electronAPI.updateMatrixLayers({ id: st.matrix.id, layers: st.matrix.layers });
  }
  updateUndoBtns(); log('Desfeito.');
}

function doRedo() {
  if (st.format === 'svg') {
    if (!st.svgRedo.length) return;
    st.svgHistory.push(st.svgDoc.outerHTML);
    var next = st.svgRedo.pop();
    replaceSvgDOM(next); saveSvg();
  } else {
    if (!st.redoStack.length) return;
    st.undoStack.push({ baseData: cloneImgData(st.baseData), colorLayers: JSON.parse(JSON.stringify(st.matrix.layers.filter(function(l){return l.type==='color';}))), textLayers: JSON.parse(JSON.stringify(st.textLayers)) });
    var snap2 = st.redoStack.pop();
    st.baseData = cloneImgData(snap2.baseData);
    edCtx.putImageData(st.baseData, 0, 0);
    st.matrix.layers = snap2.colorLayers.concat(snap2.textLayers);
    st.textLayers = JSON.parse(JSON.stringify(snap2.textLayers));
    rebuildTextDOM();
    window.electronAPI.updateMatrixLayers({ id: st.matrix.id, layers: st.matrix.layers });
  }
  updateUndoBtns(); log('Refeito.');
}

function updateUndoBtns() {
  var canUndo = st.format === 'svg' ? st.svgHistory.length > 0 : st.undoStack.length > 0;
  var canRedo = st.format === 'svg' ? st.svgRedo.length  > 0 : st.redoStack.length > 0;
  document.getElementById('btnUndo').style.opacity = canUndo ? '1' : '0.35';
  document.getElementById('btnRedo').style.opacity = canRedo ? '1' : '0.35';
}

document.getElementById('btnUndo').addEventListener('click', doUndo);
document.getElementById('btnRedo').addEventListener('click', doRedo);
document.addEventListener('keydown', function(e) {
  var inp = document.activeElement;
  if (inp && (inp.tagName === 'INPUT' || inp.tagName === 'TEXTAREA' || inp.contentEditable === 'true')) return;
  if ((e.ctrlKey||e.metaKey) && e.key === 'z') { e.preventDefault(); doUndo(); }
  if ((e.ctrlKey||e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); doRedo(); }
});

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
    if (tab === 'editor') {
      renderGallery();
      // Recompute stage transform after layout stabilises (tab was display:none before)
      if (st.matrix) requestAnimationFrame(scheduleStageTransform);
    }
  });
});

// ── Gallery search ────────────────────────────────────────────────────────────
var gallerySearchEl = document.getElementById('gallerySearch');
gallerySearchEl.addEventListener('input', function() { renderGallery(); });

// ── Gallery ───────────────────────────────────────────────────────────────────
function renderGallery() {
  var query = gallerySearchEl.value.trim().toLowerCase();
  window.electronAPI.listMatrices().then(function(res) {
    var filtered = (res.success && res.matrices) ? res.matrices.filter(function(m) {
      return !query || m.name.toLowerCase().indexOf(query) >= 0;
    }) : [];

    if (!res.success || !filtered.length) {
      galleryList.innerHTML =
        '<div class="gallery-empty"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:0.2;display:block;margin:0 auto 8px"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>' +
        '<p>' + (query ? 'Nenhuma matriz encontrada.' : 'Nenhuma matriz.<br>Clique em <strong style="color:var(--accent)">Nova Matriz</strong>.') + '</p></div>';
      return;
    }
    galleryList.innerHTML = '';
    filtered.forEach(function(m) {
      var card = document.createElement('div');
      card.className = 'matrix-card' + (st.matrix && st.matrix.id === m.id ? ' selected' : '');

      var img = document.createElement('img');
      img.className = 'matrix-thumb'; img.src = m.thumbnail;
      if (m.format === 'svg') img.style.objectFit = 'contain';

      var info = document.createElement('div'); info.className = 'matrix-info';
      var badge = m.format === 'svg'
        ? '<span style="font-size:9px;background:rgba(91,91,214,0.10);color:#5B5BD6;border:1px solid rgba(91,91,214,0.35);border-radius:3px;padding:1px 5px;margin-left:4px;">SVG</span>'
        : '';
      info.innerHTML = '<div class="matrix-name">' + esc(m.name) + badge + '</div>' +
        (m.presetName ? '<div style="font-size:9px;color:var(--accent);font-family:\'DM Mono\',monospace;margin-top:2px">preset: ' + esc(m.presetName) + '</div>' : '');

      var acts = document.createElement('div'); acts.className = 'matrix-actions';
      var btnEdit = document.createElement('button'); btnEdit.className = 'matrix-btn edit'; btnEdit.textContent = 'Editar';
      btnEdit.onclick = function(e) { e.stopPropagation(); openMatrix(m); };
      var btnDel = document.createElement('button'); btnDel.className = 'matrix-btn danger'; btnDel.textContent = 'Excluir';
      btnDel.onclick = function(e) {
        e.stopPropagation();
        if (!confirm('Excluir "' + m.name + '"?')) return;
        window.electronAPI.deleteMatrix({ id: m.id }).then(function() {
          if (st.matrix && st.matrix.id === m.id) closeEditor();
          renderGallery();
        });
      };
      acts.appendChild(btnEdit); acts.appendChild(btnDel);
      card.appendChild(img); card.appendChild(info); card.appendChild(acts);
      galleryList.appendChild(card);
    });
  }).catch(function(e) { log('Erro galeria: ' + e.message, true); });
}

// ── Upload ────────────────────────────────────────────────────────────────────
document.getElementById('btnNewMatrix').addEventListener('click', function() {
  matrixInput.value = ''; matrixInput.click();
});
matrixInput.addEventListener('change', function() {
  var file = this.files && this.files[0];
  if (!file) return;
  st.pendingFile = file;
  document.getElementById('uploadMatrixName').value = file.name.replace(/\.[^.]+$/, '');
  uploadModal.classList.add('visible');
  setTimeout(function() { var i = document.getElementById('uploadMatrixName'); i.focus(); i.select(); }, 60);
});
document.getElementById('uploadModalCancel').addEventListener('click', function() {
  uploadModal.classList.remove('visible'); st.pendingFile = null;
});
document.getElementById('uploadModalConfirm').addEventListener('click', confirmarUpload);
document.getElementById('uploadMatrixName').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') confirmarUpload();
  if (e.key === 'Escape') document.getElementById('uploadModalCancel').click();
});
function confirmarUpload() {
  var name = document.getElementById('uploadMatrixName').value.trim();
  if (!name) { log('Informe um nome.', true); return; }
  if (!st.pendingFile) { log('Arquivo perdido.', true); return; }
  uploadModal.classList.remove('visible'); st.pendingFile = null;
  var srcPath = window.electronAPI.getMatrixFilePath();
  if (!srcPath) { log('Nao foi possivel obter o caminho.', true); return; }
  var id = uid();
  log('Salvando "' + name + '"…');
  window.electronAPI.saveMatrix({ id:id, name:name, srcPath:srcPath, layers:[] })
    .then(function(res) {
      if (!res.success) { log('Erro: '+(res.error||''), true); return; }
      log('Matriz "' + name + '" salva!');
      renderGallery();
      window.electronAPI.listMatrices().then(function(r) {
        if (!r.success) return;
        var found = r.matrices.find(function(m){return m.id===id;});
        if (found) openMatrix(found);
      });
    }).catch(function(e) { log('Erro IPC: '+e.message, true); });
}

// ── Open matrix ───────────────────────────────────────────────────────────────
function openMatrix(m) {
  log('Abrindo "' + m.name + '"…');
  st.matrix     = { id:m.id, name:m.name, format:m.format, layers: m.layers ? m.layers.slice() : [], svgContent: m.svgContent||null, presetName: m.presetName||null, coordVersion: m.coordVersion || 1 };
  st.format     = m.format;
  st.textLayers = m.layers ? m.layers.filter(function(l){return l.type==='text';}).map(function(l){return JSON.parse(JSON.stringify(l));}) : [];
  st.undoStack=[]; st.redoStack=[]; st.svgHistory=[]; st.svgRedo=[];
  st.selText=null; st.editingText=null; st.svgImageEl=null;
  st.zoomMode='fit'; st.zoomLevel=1;
  updateUndoBtns();

  // Update preset selector
  populatePresetSelect();

  window.electronAPI.readMatrixImage({ id:m.id }).then(function(res) {
    if (!res.success) { log('Erro ao ler: '+(res.error||''), true); return; }

    document.getElementById('editorEmpty').style.display = 'none';
    editorStage.style.display = 'block';
    tlDiv.style.display = 'block';

    if (res.format === 'svg') {
      openSvgEditor(m, res.svgText);
    } else {
      openRasterEditor(m, res.imageBase64);
    }
    renderTextLayerList();
    renderGallery();
  });
}

function closeEditor() {
  st.matrix=null; st.format=null; st.baseData=null; st.origData=null;
  st.undoStack=[]; st.redoStack=[]; st.svgHistory=[]; st.svgRedo=[];
  st.textLayers=[]; st.selText=null; st.editingText=null; st.svgImageEl=null;
  st.natW=0; st.natH=0;
  edCanvas.style.display='none';
  svgWrap.innerHTML=''; svgWrap.className='';
  tlDiv.innerHTML=''; tlDiv.style.display='none';
  editorStage.style.display='none';
  hideSvgPanel();
  document.getElementById('editorEmpty').style.display='flex';
  document.getElementById('erpTextPropsSection').style.display='none';
  renderTextLayerList();
  updateUndoBtns();
}

// ── SVG Editor ────────────────────────────────────────────────────────────────
function openSvgEditor(m, svgText) {
  edCanvas.style.display = 'none';
  svgWrap.classList.add('visible');

  var xmlToUse = (m.svgContent && m.svgContent.trim()) ? m.svgContent : svgText;

  // If this is original (no saved edits), split compound paths into subpaths
  // so each shape is individually clickable
  if (!m.svgContent || !m.svgContent.trim()) {
    if (xmlToUse.indexOf('<path') !== -1) xmlToUse = splitCompoundPaths(xmlToUse);
  }

  svgWrap.innerHTML = xmlToUse;
  st.svgDoc = svgWrap.querySelector('svg');
  if (!st.svgDoc) { log('SVG invalido.', true); return; }

  // Natural size = source width/height or viewBox; rendered at full size, scaled via stage transform
  var vb = st.svgDoc.getAttribute('viewBox');
  st.natW = parseFloat(st.svgDoc.getAttribute('width')  || (vb ? vb.split(/[\s,]+/)[2] : 800));
  st.natH = parseFloat(st.svgDoc.getAttribute('height') || (vb ? vb.split(/[\s,]+/)[3] : 600));
  st.svgDoc.setAttribute('width',  st.natW);
  st.svgDoc.setAttribute('height', st.natH);

  detectSvgRasterImage();
  attachSvgListeners();
  applyStageTransform();
  rebuildTextDOM();
  var msg;
  if (st.svgImageEl) {
    msg = 'SVG aberto (imagem incorporada). Use a ferramenta Cor e clique na imagem para trocar cores.';
  } else {
    msg = 'SVG aberto. ' + st.svgDoc.querySelectorAll('path,rect,circle,ellipse,polygon').length + ' elemento(s) clicaveis.';
  }
  if (st.matrix.coordVersion < 2 && st.textLayers.length) msg += ' Atencao: textos desta matriz vem do editor antigo — confira o posicionamento.';
  log(msg);
}

// Split each <path> with compound d (multiple M subpaths) into individual <path> elements
function splitCompoundPaths(svgStr) {
  var parser = new DOMParser();
  var doc    = parser.parseFromString(svgStr, 'image/svg+xml');
  var paths  = doc.querySelectorAll('path');

  paths.forEach(function(pathEl) {
    var d    = pathEl.getAttribute('d') || '';
    var fill = pathEl.getAttribute('fill') || '';
    var subs = splitPathD(d);

    // Only split if there are multiple subpaths
    if (subs.length <= 1) return;

    var parent = pathEl.parentNode;
    subs.forEach(function(subD) {
      if (!subD.trim()) return;
      var newPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      // Copy all attributes
      Array.from(pathEl.attributes).forEach(function(attr) {
        newPath.setAttribute(attr.name, attr.value);
      });
      newPath.setAttribute('d', subD.trim());
      parent.insertBefore(newPath, pathEl);
    });
    parent.removeChild(pathEl);
  });

  return new XMLSerializer().serializeToString(doc.documentElement);
}

// Split a compound path d attribute into individual M...Z subpaths
function splitPathD(d) {
  // Split on M or m that is preceded by Z or z (subpath boundary)
  // Strategy: find all M/m commands that start a new subpath after a Z/z or at beginning
  var parts = [];
  // Match each subpath: starts with M/m, ends with Z/z or end of string
  var re = /[Mm][^Mm]*/g;
  var match;
  var current = '';
  // Better approach: split on 'M' or 'm' at the start of a new subpath
  // A new subpath starts after Z/z
  var tokens = d.split(/(?=[Mm])/);
  tokens.forEach(function(token) {
    token = token.trim();
    if (!token) return;
    if (current === '') {
      current = token;
    } else {
      // If previous ended with Z/z, this is a new subpath
      var prevTrimmed = current.trimEnd();
      if (/[Zz]$/.test(prevTrimmed)) {
        parts.push(current);
        current = token;
      } else {
        // Continuation of same subpath
        current += ' ' + token;
      }
    }
  });
  if (current) parts.push(current);
  return parts.length > 0 ? parts : [d];
}

function replaceSvgDOM(xmlStr) {
  svgWrap.innerHTML = xmlStr;
  st.svgDoc = svgWrap.querySelector('svg');
  st.svgDoc.setAttribute('width',  st.natW);
  st.svgDoc.setAttribute('height', st.natH);
  detectSvgRasterImage();
  attachSvgListeners();
  applyStageTransform();
  rebuildTextDOM();
}

function attachSvgListeners() {
  if (!st.svgDoc) return;
  var fillable = st.svgDoc.querySelectorAll('path, rect, circle, ellipse, polygon, polyline');
  fillable.forEach(function(el) {
    el.addEventListener('click', onSvgElementClick);
    el.style.cursor = 'crosshair';
  });
  // Update cursor class on wrap
  svgWrap.className = 'visible tool-' + st.tool;
}

// Some "SVG" matrices are just a raster image wrapped in <svg><image href="data:..."/></svg>
// (no fillable vector shapes). For those, color replacement works on the embedded
// raster pixels (like the raster editor), writing the result back into <image href>.
function detectSvgRasterImage() {
  if (!st.svgDoc) { st.svgImageEl = null; st.baseData = null; return; }
  var fillable = st.svgDoc.querySelectorAll('path,rect,circle,ellipse,polygon,polyline');
  var imageEl  = st.svgDoc.querySelector('image');
  st.svgImageEl = (fillable.length === 0 && imageEl) ? imageEl : null;
  if (st.svgImageEl) {
    st.svgImageEl.style.cursor = st.tool === 'color' ? 'crosshair' : st.tool === 'text' ? 'text' : 'default';
    loadSvgImageData();
  } else {
    st.baseData = null;
  }
}

function loadSvgImageData() {
  var href = st.svgImageEl.getAttribute('href') || st.svgImageEl.getAttribute('xlink:href');
  var img = new Image();
  img.onload = function() {
    var tmp = document.createElement('canvas');
    tmp.width = st.natW; tmp.height = st.natH;
    tmp.getContext('2d').drawImage(img, 0, 0, st.natW, st.natH);
    st.baseData = cloneImgData(tmp.getContext('2d').getImageData(0, 0, st.natW, st.natH));
  };
  img.src = href;
}

function updateSvgImageFromBaseData() {
  var tmp = document.createElement('canvas');
  tmp.width = st.natW; tmp.height = st.natH;
  tmp.getContext('2d').putImageData(st.baseData, 0, 0);
  st.svgImageEl.setAttribute('href', tmp.toDataURL('image/png'));
}

// Color replace on the embedded raster image of a raster-backed SVG
function svgColorClick(e, rect) {
  var x = Math.round((e.clientX - rect.left) / st.displayScale);
  var y = Math.round((e.clientY - rect.top)  / st.displayScale);
  if (x < 0 || x >= st.natW || y < 0 || y >= st.natH) return;
  var tol   = parseInt(document.getElementById('colorTolerance').value);
  var toHex = document.getElementById('replaceColor').value;
  var d = st.baseData.data, i = (y * st.natW + x) * 4;
  var fromHex = '#' + h2(d[i]) + h2(d[i+1]) + h2(d[i+2]);
  pushUndo();
  st.baseData = colorReplace(st.baseData, fromHex, toHex, tol);
  updateSvgImageFromBaseData();
  saveSvg();
  addRecentColor(toHex);
  log('Cor: ' + fromHex + ' → ' + toHex);
}

// Selected SVG element
var svgSelectedEl = null;
var svgSelectedOrigColor = null; // color at time of click (for "apply all")

function onSvgElementClick(e) {
  if (st.tool !== 'color') return;
  e.stopPropagation();

  if (svgSelectedEl) svgSelectedEl.classList.remove('svg-selected-el');
  svgSelectedEl = e.currentTarget;
  svgSelectedEl.classList.add('svg-selected-el');

  var fill = svgSelectedEl.getAttribute('fill') || svgSelectedEl.style.fill || '';
  var hex  = normalizeColorToHex(fill);
  svgSelectedOrigColor = hex; // store for "apply all"

  // Count elements with same fill
  var allFillable = st.svgDoc.querySelectorAll('path,rect,circle,ellipse,polygon,polyline');
  var sameCount = 0;
  allFillable.forEach(function(el) {
    if (normalizeColorToHex(el.getAttribute('fill') || el.style.fill || '') === hex) sameCount++;
  });

  showSvgPanel(hex, sameCount, e.clientX, e.clientY);
}

function normalizeColorToHex(colorStr) {
  if (!colorStr || colorStr === 'none' || colorStr === 'transparent') return '#000000';
  colorStr = colorStr.trim();
  if (colorStr.startsWith('#')) {
    if (colorStr.length === 4) {
      return '#' + colorStr[1]+colorStr[1]+colorStr[2]+colorStr[2]+colorStr[3]+colorStr[3];
    }
    return colorStr.toLowerCase();
  }
  var m = colorStr.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return rgbToHex(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]));
  // Named colors: use canvas to resolve
  var tmp = document.createElement('canvas');
  tmp.width = tmp.height = 1;
  var ctx2 = tmp.getContext('2d');
  ctx2.fillStyle = colorStr;
  ctx2.fillRect(0,0,1,1);
  var d = ctx2.getImageData(0,0,1,1).data;
  return rgbToHex(d[0], d[1], d[2]);
}

// SVG Color Panel
function showSvgPanel(currentHex, sameCount, clientX, clientY) {
  document.getElementById('scpSwatch').style.background = currentHex;
  document.getElementById('scpColorPicker').value = currentHex;
  document.getElementById('scpGroupInfo').textContent = sameCount + ' elemento(s) com esta cor';
  document.getElementById('scpLabel').textContent = currentHex.toUpperCase();
  svgPanel.classList.add('visible');

  // Position near click, inside editor area
  var ar = document.getElementById('editorCanvasArea').getBoundingClientRect();
  var px = clientX - ar.left + 12;
  var py = clientY - ar.top  + 12;
  if (px + 220 > ar.width)  px = clientX - ar.left - 220;
  if (py + 120 > ar.height) py = clientY - ar.top  - 120;
  svgPanel.style.left = px + 'px';
  svgPanel.style.top  = py + 'px';
}

function hideSvgPanel() {
  svgPanel.classList.remove('visible');
  if (svgSelectedEl) { svgSelectedEl.classList.remove('svg-selected-el'); svgSelectedEl = null; }
}

// Update swatch preview when color picker changes
document.getElementById('scpColorPicker').addEventListener('input', function() {
  document.getElementById('scpSwatch').style.background = this.value;
});

document.getElementById('scpApply').addEventListener('click', function() {
  if (!svgSelectedEl) return;
  var newColor = document.getElementById('scpColorPicker').value;
  pushUndo();
  // Apply ONLY to the clicked element
  svgSelectedEl.setAttribute('fill', newColor);
  svgSelectedEl.style.fill = newColor;
  addRecentColor(newColor);
  saveSvg();
  hideSvgPanel();
  log('Cor aplicada ao elemento.');
});

document.getElementById('scpApplyAll').addEventListener('click', function() {
  if (!svgSelectedEl || !st.svgDoc) return;
  var newColor = document.getElementById('scpColorPicker').value;
  var origHex  = svgSelectedOrigColor; // color recorded at click time
  if (!origHex) return;
  pushUndo();
  var allFillable = st.svgDoc.querySelectorAll('path,rect,circle,ellipse,polygon,polyline');
  var count = 0;
  allFillable.forEach(function(el) {
    var f = normalizeColorToHex(el.getAttribute('fill') || el.style.fill || '');
    if (f === origHex) {
      el.setAttribute('fill', newColor);
      el.style.fill = newColor;
      count++;
    }
  });
  addRecentColor(newColor);
  saveSvg();
  hideSvgPanel();
  log('Cor aplicada a ' + count + ' elemento(s) com cor ' + origHex + '.');
});

document.getElementById('scpClose').addEventListener('click', hideSvgPanel);

// Click outside SVG panel closes it
document.getElementById('editorCanvasArea').addEventListener('click', function(e) {
  if (!svgPanel.contains(e.target) && e.target !== svgWrap && !svgWrap.contains(e.target)) {
    hideSvgPanel();
  }
});

function saveSvg() {
  if (!st.matrix || !st.svgDoc) return;
  var xmlStr = st.svgDoc.outerHTML;
  window.electronAPI.saveSvgContent({ id: st.matrix.id, svgContent: xmlStr });
}

// ── Raster Editor ─────────────────────────────────────────────────────────────
function openRasterEditor(m, imageBase64) {
  svgWrap.innerHTML = ''; svgWrap.className = '';
  edCanvas.style.display = 'block';

  var img = new Image();
  img.onload = function() {
    edCanvas.width  = img.naturalWidth;
    edCanvas.height = img.naturalHeight;
    st.natW = img.naturalWidth;
    st.natH = img.naturalHeight;
    edCtx.drawImage(img, 0, 0);
    st.origData = cloneImgData(edCtx.getImageData(0,0,edCanvas.width,edCanvas.height));
    // Re-apply saved color layers
    var base = cloneImgData(st.origData);
    var colorLayers = st.matrix.layers.filter(function(l){return l.type==='color';});
    colorLayers.forEach(function(cl) { base = colorReplace(base, cl.fromColor, cl.toColor, cl.tolerance); });
    edCtx.putImageData(base, 0, 0);
    st.baseData = base;
    applyStageTransform();
    rebuildTextDOM();
    var msg = 'Raster aberto. ' + colorLayers.length + ' troca(s) de cor, ' + st.textLayers.length + ' texto(s).';
    if (st.matrix.coordVersion < 2 && st.textLayers.length) msg += ' Atencao: textos desta matriz vem do editor antigo — confira o posicionamento.';
    log(msg);
  };
  img.onerror = function() { log('Erro ao carregar imagem.', true); };
  img.src = imageBase64;
}

// Raster color replace
edCanvas.addEventListener('click', function(e) {
  if (st.tool !== 'color' || !st.baseData) return;
  var rect = edCanvas.getBoundingClientRect();
  var x = Math.round((e.clientX-rect.left)*edCanvas.width/rect.width);
  var y = Math.round((e.clientY-rect.top)*edCanvas.height/rect.height);
  if (x<0||x>=edCanvas.width||y<0||y>=edCanvas.height) return;
  var tol=parseInt(document.getElementById('colorTolerance').value);
  var toHex=document.getElementById('replaceColor').value;
  var d=st.baseData.data, i=(y*edCanvas.width+x)*4;
  var fromHex='#'+h2(d[i])+h2(d[i+1])+h2(d[i+2]);
  pushUndo();
  st.baseData = colorReplace(st.baseData, fromHex, toHex, tol);
  edCtx.putImageData(st.baseData, 0, 0);
  st.matrix.layers.push({ type:'color', fromColor:fromHex, toColor:toHex, tolerance:tol });
  st.matrix.coordVersion = 2;
  window.electronAPI.updateMatrixLayers({ id:st.matrix.id, layers:st.matrix.layers, coordVersion: 2 });
  addRecentColor(toHex);
  log('Cor: ' + fromHex + ' → ' + toHex);
});

function h2(n) { return ('0'+n.toString(16)).slice(-2); }

function colorReplace(imgData, fromHex, toHex, tol) {
  var from=hexToRgb(fromHex), to=hexToRgb(toHex);
  var tol2 = tol*tol;
  var src=imgData.data, dst=edCtx.createImageData(imgData.width,imgData.height), out=dst.data;
  for (var i=0;i<src.length;i+=4) {
    var dr=src[i]-from[0], dg=src[i+1]-from[1], db=src[i+2]-from[2];
    if (dr*dr+dg*dg+db*db<=tol2) { out[i]=to[0];out[i+1]=to[1];out[i+2]=to[2];out[i+3]=src[i+3]; }
    else { out[i]=src[i];out[i+1]=src[i+1];out[i+2]=src[i+2];out[i+3]=src[i+3]; }
  }
  return dst;
}

// ── Tools ─────────────────────────────────────────────────────────────────────
document.getElementById('toolNone').addEventListener('click',  function(){setTool('none');});
document.getElementById('toolColor').addEventListener('click', function(){setTool('color');});
document.getElementById('toolText').addEventListener('click',  function(){setTool('text');});

function setTool(t) {
  st.tool = t;
  document.getElementById('toolNone').classList.toggle('active',  t==='none');
  document.getElementById('toolColor').classList.toggle('active', t==='color');
  document.getElementById('toolText').classList.toggle('active',  t==='text');
  document.getElementById('colorPickerGroup').style.display = (t==='color' && (st.format==='raster' || st.svgImageEl)) ? 'flex' : 'none';
  // Update cursors
  edCanvas.style.cursor = t==='text' ? 'text' : t==='none' ? 'default' : 'crosshair';
  if (st.svgDoc) {
    svgWrap.className = 'visible tool-' + t;
    var fillable = st.svgDoc.querySelectorAll('path,rect,circle,ellipse,polygon,polyline');
    fillable.forEach(function(el) {
      el.style.cursor = t==='color' ? 'crosshair' : t==='text' ? 'text' : 'default';
      el.style.pointerEvents = t==='none' ? 'none' : 'all';
    });
    if (st.svgImageEl) {
      st.svgImageEl.style.cursor = t==='color' ? 'crosshair' : t==='text' ? 'text' : 'default';
    }
  }
  if (t !== 'text') { commitInlineEdit(); deselText(); }
  if (t !== 'color') hideSvgPanel();
}

document.getElementById('colorTolerance').addEventListener('input', function() {
  document.getElementById('tolValue').textContent = this.value;
});

// ── Text layers ───────────────────────────────────────────────────────────────
// Add text by clicking canvas (raster) or SVG wrap — convert display coords to natural coords
edCanvas.addEventListener('click', function(e) {
  if (st.tool !== 'text') return;
  var rect = edCanvas.getBoundingClientRect();
  pushUndo();
  addText((e.clientX-rect.left)/st.displayScale, (e.clientY-rect.top)/st.displayScale);
});

svgWrap.addEventListener('click', function(e) {
  if (svgPanel.contains(e.target)) return;
  var rect = svgWrap.getBoundingClientRect();
  if (st.tool === 'text') {
    pushUndo();
    addText((e.clientX-rect.left)/st.displayScale, (e.clientY-rect.top)/st.displayScale);
    return;
  }
  if (st.tool === 'color' && st.svgImageEl && st.baseData) {
    svgColorClick(e, rect);
  }
});

function addText(x, y) {
  var font = document.getElementById('tpFont').value || 'Arial';
  var layer = { id:uid(), type:'text', text:'Texto', font:font, size:32, color:'#ffffff', bold:false, x:x, y:y };
  st.textLayers.push(layer);
  rebuildTextDOM();
  selText(layer.id);
  renderTextLayerList();
  saveLayers();
}

// Draws text layers with fillText — shared by the editor overlay and the
// Tiler export so both are pixel-identical (CSS box-model text metrics don't
// match canvas fillText metrics, so the visible text must be canvas-rendered
// in both places). skipId lets the layer being inline-edited render via DOM instead.
function drawTextLayers(ctx, layers, skipId) {
  ctx.textBaseline = 'top';
  layers.forEach(function(l) {
    if (l.id === skipId) return;
    ctx.save();
    ctx.font      = (l.bold ? 'bold ' : '') + l.size + 'px "' + l.font + '"';
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, l.x, l.y);
    ctx.restore();
  });
}

function renderTextOverlay() {
  if (textOverlay.width !== st.natW)  textOverlay.width  = st.natW;
  if (textOverlay.height !== st.natH) textOverlay.height = st.natH;
  tocCtx.clearRect(0, 0, textOverlay.width, textOverlay.height);
  drawTextLayers(tocCtx, st.textLayers, st.editingText);
}

// Text layer geometry is stored in natural coordinates; #editorStageInner's
// CSS transform handles scaling, so positions never need recomputation here.
function rebuildTextDOM() {
  tlDiv.innerHTML = '';
  st.textLayers.forEach(function(layer) { createTextEl(layer); });
  renderTextOverlay();
}

function createTextEl(layer) {
  var el = document.createElement('div');
  el.className    = 'text-layer-el' + (layer.id===st.selText?' selected':'');
  el.dataset.lid  = layer.id;
  el.style.position   = 'absolute';
  el.style.left       = layer.x + 'px';
  el.style.top        = layer.y + 'px';
  el.style.fontSize   = layer.size + 'px';
  el.style.fontFamily = '"' + layer.font + '"';
  el.style.fontWeight = layer.bold ? 'bold' : 'normal';
  el.style.whiteSpace = 'pre';
  el.style.userSelect = 'none';
  el.textContent = layer.text;

  var del = document.createElement('button');
  del.className='text-del'; del.textContent='×';
  del.onclick = function(ev) { ev.stopPropagation(); deleteTextLayer(layer.id); };
  el.appendChild(del);

  el.addEventListener('mousedown', function(ev) {
    if (st.editingText===layer.id) return;
    ev.stopPropagation(); ev.preventDefault();
    selText(layer.id); startDrag(ev, el, layer);
  });
  el.addEventListener('dblclick', function(ev) {
    ev.stopPropagation(); startInlineEdit(layer, el);
  });
  tlDiv.appendChild(el);
  return el;
}

function deleteTextLayer(id) {
  commitInlineEdit();
  pushUndo();
  st.textLayers = st.textLayers.filter(function(l){return l.id!==id;});
  if (st.selText===id) { st.selText=null; document.getElementById('erpTextPropsSection').style.display='none'; }
  rebuildTextDOM();
  renderTextLayerList();
  saveLayers();
}

function selText(id) {
  st.selText = id;
  var l = st.textLayers.find(function(x){return x.id===id;});
  if (!l) return;
  Array.from(tlDiv.children).forEach(function(el){el.classList.toggle('selected', el.dataset.lid===id);});
  document.getElementById('erpTextPropsSection').style.display = 'flex';
  document.getElementById('tpContent').value=l.text;
  document.getElementById('tpFont').value=l.font;
  document.getElementById('tpSize').value=l.size;
  document.getElementById('tpColor').value=l.color;
  document.getElementById('tpBold').checked=l.bold;
  renderTextLayerList();
}

function deselText() {
  commitInlineEdit();
  st.selText=null;
  Array.from(tlDiv.children).forEach(function(el){el.classList.remove('selected');});
  document.getElementById('erpTextPropsSection').style.display = 'none';
  renderTextLayerList();
}

document.getElementById('editorCanvasArea').addEventListener('mousedown', function(e) {
  if (e.target === edCanvas || e.target === this || e.target === svgWrap) {
    commitInlineEdit();
    if (st.tool !== 'text') deselText();
  }
});

// Inline text editing
function startInlineEdit(layer, el) {
  commitInlineEdit();
  st.editingText = layer.id;
  el.contentEditable='true'; el.style.userSelect='text'; el.style.cursor='text';
  el.style.outline='2px solid var(--accent)';
  el.style.color=layer.color; // visible while editing — overlay canvas skips this layer
  renderTextOverlay();
  var range=document.createRange(); range.selectNodeContents(el);
  var sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  el.focus();
  el.addEventListener('blur', function onBlur(){el.removeEventListener('blur',onBlur);commitInlineEdit();});
  el.addEventListener('keydown', function onKey(ev){
    if (ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();el.removeEventListener('keydown',onKey);commitInlineEdit();}
    if (ev.key==='Escape'){el.removeEventListener('keydown',onKey);commitInlineEdit();}
  });
}

function commitInlineEdit() {
  if (!st.editingText) return;
  var id=st.editingText; st.editingText=null;
  var el=tlDiv.querySelector('[data-lid="'+id+'"]');
  var layer=st.textLayers.find(function(l){return l.id===id;});
  if (el && layer) {
    var newText = Array.from(el.childNodes).filter(function(n){return n.nodeType===3;}).map(function(n){return n.textContent;}).join('').trim();
    if (!newText) newText = el.innerText.replace('×','').trim();
    layer.text = newText || layer.text;
    el.contentEditable='false'; el.style.userSelect='none'; el.style.cursor='';
    el.style.outline=''; el.style.color='transparent'; el.textContent=layer.text;
    var del=document.createElement('button'); del.className='text-del'; del.textContent='×';
    del.onclick=function(ev){ ev.stopPropagation(); deleteTextLayer(id); };
    el.appendChild(del);
    document.getElementById('tpContent').value=layer.text;
    renderTextOverlay();
    renderTextLayerList();
    saveLayers();
  }
}

// Drag — delta divided by displayScale converts screen px back to natural coords
function startDrag(e, el, layer) {
  e.preventDefault();
  var sx=e.clientX, sy=e.clientY, ox=layer.x, oy=layer.y;
  function mv(ev) {
    ev.preventDefault();
    layer.x = ox + (ev.clientX - sx) / st.displayScale;
    layer.y = oy + (ev.clientY - sy) / st.displayScale;
    el.style.left = layer.x + 'px';
    el.style.top  = layer.y + 'px';
    renderTextOverlay();
  }
  function up() {
    document.removeEventListener('mousemove', mv);
    document.removeEventListener('mouseup',   up);
    saveLayers();
  }
  document.addEventListener('mousemove', mv);
  document.addEventListener('mouseup',   up);
}

// Update text style without full rebuild
function updLayer(key, val) {
  var l=st.textLayers.find(function(x){return x.id===st.selText;});
  if (!l) return;
  l[key]=val;
  var el=tlDiv.querySelector('[data-lid="'+l.id+'"]');
  if (el) {
    if (key==='text' && st.editingText!==l.id) {
      el.textContent=val;
      var d2=document.createElement('button'); d2.className='text-del'; d2.textContent='×';
      d2.onclick=function(ev){ ev.stopPropagation(); deleteTextLayer(l.id); };
      el.appendChild(d2);
    }
    if (key==='size')  el.style.fontSize=val+'px';
    if (key==='font')  el.style.fontFamily='"'+val+'"';
    if (key==='bold')  el.style.fontWeight=val?'bold':'normal';
  }
  renderTextOverlay();
  renderTextLayerList();
  saveLayers();
}
document.getElementById('tpContent').addEventListener('input',  function(){updLayer('text',  this.value);});
document.getElementById('tpFont').addEventListener('change',    function(){updLayer('font',  this.value);});
document.getElementById('tpSize').addEventListener('input',     function(){updLayer('size',  parseInt(this.value)||32);});
document.getElementById('tpColor').addEventListener('input',    function(){updLayer('color', this.value);});
document.getElementById('tpColor').addEventListener('change',   function(){addRecentColor(this.value);});
document.getElementById('tpBold').addEventListener('change',    function(){updLayer('bold',  this.checked);});

// ── Preset selector ───────────────────────────────────────────────────────────
function populatePresetSelect() {
  var sel = document.getElementById('matrixPresetSelect');
  if (!sel) return;
  var PRESETS_KEY = 'imagetiler_presets_v1';
  var presets = {};
  try { presets = JSON.parse(localStorage.getItem(PRESETS_KEY)) || {}; } catch(e) {}
  sel.innerHTML = '<option value="">— nenhum —</option>';
  Object.keys(presets).forEach(function(name) {
    var opt = document.createElement('option'); opt.value=name; opt.textContent=name; sel.appendChild(opt);
  });
  sel.value = (st.matrix && st.matrix.presetName) ? st.matrix.presetName : '';
}

var presetSel = document.getElementById('matrixPresetSelect');
if (presetSel) {
  presetSel.addEventListener('change', function() {
    if (!st.matrix) return;
    var name = this.value || null;
    st.matrix.presetName = name;
    window.electronAPI.updateMatrixMeta({ id: st.matrix.id, presetName: name });
    log(name ? 'Preset "'+name+'" vinculado.' : 'Preset desvinculado.');
    renderGallery();
  });
}

// ── Save layers (raster text + colors) ───────────────────────────────────────
function saveLayers() {
  if (!st.matrix) return;
  var colorLayers = st.matrix.layers.filter(function(l){return l.type==='color';});
  st.matrix.layers = colorLayers.concat(st.textLayers);
  st.matrix.coordVersion = 2;
  window.electronAPI.updateMatrixLayers({ id:st.matrix.id, layers:st.matrix.layers, coordVersion: 2 });
}

// ── System fonts ──────────────────────────────────────────────────────────────
function loadSystemFonts() {
  if (!window.queryLocalFonts) return;
  window.queryLocalFonts().then(function(fonts) {
    var seen={}, names=[];
    fonts.forEach(function(f){if(!seen[f.family]){seen[f.family]=true;names.push(f.family);}});
    names.sort();
    var sel=document.getElementById('tpFont'); sel.innerHTML='';
    names.forEach(function(name){var o=document.createElement('option');o.value=name;o.textContent=name;sel.appendChild(o);});
    sel.value='Arial';
    log(names.length+' fontes carregadas.');
  }).catch(function(){});
}

// ── Composite render — pixel-perfect: base image (with color edits) + text overlay ───
// Used by both "Usar no Tiler" and "Exportar Imagem" so the output is identical.
function buildCompositeCanvas() {
  return new Promise(function(resolve, reject) {
    if (!st.matrix) { reject(new Error('Nenhuma matriz aberta.')); return; }
    commitInlineEdit();

    var W = st.natW, H = st.natH;
    var exp = document.createElement('canvas');
    exp.width = W; exp.height = H;
    var ectx = exp.getContext('2d');

    function finish() {
      drawTextLayers(ectx, st.textLayers);
      resolve(exp);
    }

    if (st.format === 'svg' && st.svgDoc) {
      // Serialize the current SVG DOM (with color edits) at natural size → drawImage
      var svgClone = st.svgDoc.cloneNode(true);
      svgClone.setAttribute('width',  W);
      svgClone.setAttribute('height', H);
      var svgStr  = new XMLSerializer().serializeToString(svgClone);
      var blob    = new Blob([svgStr], { type: 'image/svg+xml' });
      var blobUrl = URL.createObjectURL(blob);
      var imgEl   = new Image();
      imgEl.onload = function() {
        ectx.drawImage(imgEl, 0, 0, W, H);
        URL.revokeObjectURL(blobUrl);
        finish();
      };
      imgEl.onerror = function() { URL.revokeObjectURL(blobUrl); reject(new Error('Erro ao renderizar SVG.')); };
      imgEl.src = blobUrl;
    } else if (st.baseData) {
      ectx.putImageData(st.baseData, 0, 0);
      finish();
    } else {
      reject(new Error('Nada para exportar.'));
    }
  });
}

// ── Send to Tiler ───────────────────────────────────────────────────────────
document.getElementById('btnSendToTiler').addEventListener('click', function() {
  if (!st.matrix) { log('Nenhuma matriz aberta.', true); return; }

  // Apply linked preset if any
  var presetName = st.matrix.presetName;
  if (presetName) {
    var PRESETS_KEY = 'imagetiler_presets_v1';
    var presets = {};
    try { presets = JSON.parse(localStorage.getItem(PRESETS_KEY)) || {}; } catch(e) {}
    if (presets[presetName] && typeof window._tilerApplyPreset === 'function') {
      window._tilerApplyPreset(presetName, presets[presetName]);
    }
  }

  buildCompositeCanvas().then(function(exp) {
    var url = exp.toDataURL('image/png');
    var img = new Image();
    img.onload = function() {
      document.querySelector('.tab-btn[data-tab="tiler"]').click();
      if (typeof window._tilerLoadImageFromDataUrl === 'function') {
        window._tilerLoadImageFromDataUrl(url, img);
      }
    };
    img.src = url;
    log('Enviado para o Tiler' + (presetName ? ' com preset "' + presetName + '"' : '') + '.');
  }).catch(function(err) { log(err.message, true); });
});

// ── Export as PNG/JPEG — same composite, saved to disk ────────────────────────
document.getElementById('btnExportImage').addEventListener('click', function() {
  if (!st.matrix) { log('Nenhuma matriz aberta.', true); return; }

  buildCompositeCanvas().then(function(exp) {
    var safeName = (st.matrix.name || 'matriz').replace(/[\\/:*?"<>|]/g, '_');
    return window.electronAPI.exportImageDialog(safeName + '.png').then(function(dlg) {
      if (!dlg.success) return;
      var ext  = dlg.filePath.split('.').pop().toLowerCase();
      var isJpeg = ext === 'jpg' || ext === 'jpeg';
      var src = exp;
      if (isJpeg) {
        // JPEG has no alpha channel — flatten onto a white background first
        src = document.createElement('canvas');
        src.width = exp.width; src.height = exp.height;
        var sctx = src.getContext('2d');
        sctx.fillStyle = '#fff';
        sctx.fillRect(0, 0, src.width, src.height);
        sctx.drawImage(exp, 0, 0);
      }
      var dataUrl = isJpeg ? src.toDataURL('image/jpeg', 0.92) : src.toDataURL('image/png');
      var b64   = dataUrl.split(',')[1];
      var bytes = Uint8Array.from(atob(b64), function(c) { return c.charCodeAt(0); });
      return window.electronAPI.writeImageFile({ filePath: dlg.filePath, bytes: Array.from(bytes) }).then(function(result) {
        if (result.success) log('Exportado: ' + result.filePath, false);
        else log('Erro ao exportar: ' + result.error, true);
      });
    });
  }).catch(function(err) { log(err.message, true); });
});

// ── Recompute stage transform when canvas area resizes ────────────────────────
function onLayoutChange() {
  if (!st.matrix) return;
  scheduleStageTransform();
}
if (window.ResizeObserver) {
  var ro = new ResizeObserver(onLayoutChange);
  ro.observe(canvasArea);
} else {
  window.addEventListener('resize', onLayoutChange);
}

// ── Zoom controls ─────────────────────────────────────────────────────────────
document.getElementById('edZoomIn').addEventListener('click', function() {
  if (!st.matrix) return;
  st.zoomMode = 'manual';
  st.zoomLevel = Math.min(ZOOM_MAX, Math.round((st.displayScale + ZOOM_STEP) * 100) / 100);
  applyStageTransform();
});
document.getElementById('edZoomOut').addEventListener('click', function() {
  if (!st.matrix) return;
  st.zoomMode = 'manual';
  st.zoomLevel = Math.max(ZOOM_MIN, Math.round((st.displayScale - ZOOM_STEP) * 100) / 100);
  applyStageTransform();
});
document.getElementById('edZoomFit').addEventListener('click', function() {
  if (!st.matrix) return;
  st.zoomMode = 'fit';
  applyStageTransform();
});

// Ctrl+Scroll to zoom in/out around current view
canvasArea.addEventListener('wheel', function(e) {
  if (!e.ctrlKey || !st.matrix) return;
  e.preventDefault();
  st.zoomMode = 'manual';
  var delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
  st.zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((st.displayScale + delta) * 100) / 100));
  applyStageTransform();
}, { passive: false });

// ── Pan with Space+drag ───────────────────────────────────────────────────────
var spacePan = { active: false };
document.addEventListener('keydown', function(e) {
  if (e.code !== 'Space') return;
  var t = document.activeElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.contentEditable === 'true')) return;
  if (!spacePan.active) { spacePan.active = true; canvasArea.style.cursor = 'grab'; }
  e.preventDefault();
});
document.addEventListener('keyup', function(e) {
  if (e.code !== 'Space') return;
  spacePan.active = false;
  canvasArea.style.cursor = '';
});
canvasArea.addEventListener('mousedown', function(e) {
  if (!spacePan.active) return;
  e.preventDefault(); e.stopPropagation();
  canvasArea.style.cursor = 'grabbing';
  var sx = e.clientX, sy = e.clientY;
  var sl = canvasArea.scrollLeft, stop = canvasArea.scrollTop;
  function mv(ev) {
    canvasArea.scrollLeft = sl - (ev.clientX - sx);
    canvasArea.scrollTop  = stop - (ev.clientY - sy);
  }
  function up() {
    canvasArea.style.cursor = spacePan.active ? 'grab' : '';
    document.removeEventListener('mousemove', mv);
    document.removeEventListener('mouseup', up);
  }
  document.addEventListener('mousemove', mv);
  document.addEventListener('mouseup', up);
}, true);

// ── Eyedropper (window.EyeDropper, Chromium) ──────────────────────────────────
function attachEyedropper(buttonId, colorInputId) {
  var btn = document.getElementById(buttonId);
  if (!btn) return;
  if (typeof window.EyeDropper !== 'function') { btn.style.display = 'none'; return; }
  btn.addEventListener('click', function() {
    new window.EyeDropper().open().then(function(r) {
      var input = document.getElementById(colorInputId);
      input.value = r.sRGBHex;
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }).catch(function(){});
  });
}
attachEyedropper('replaceColorEyedropper', 'replaceColor');
attachEyedropper('scpColorEyedropper',     'scpColorPicker');
attachEyedropper('tpColorEyedropper',      'tpColor');

// ── Recent colors palette ─────────────────────────────────────────────────────
var RECENT_COLORS_KEY = 'imagetiler_recent_colors_v1';
var RECENT_COLORS_MAX = 12;
function getRecentColors() {
  try { return JSON.parse(localStorage.getItem(RECENT_COLORS_KEY)) || []; } catch(e) { return []; }
}
function addRecentColor(hex) {
  if (!hex) return;
  hex = hex.toLowerCase();
  var colors = getRecentColors().filter(function(c){ return c !== hex; });
  colors.unshift(hex);
  if (colors.length > RECENT_COLORS_MAX) colors = colors.slice(0, RECENT_COLORS_MAX);
  localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(colors));
  renderRecentColors();
}
function renderRecentColors() {
  var colors = getRecentColors();
  document.querySelectorAll('.recent-colors-grid').forEach(function(grid) {
    var targetId = grid.dataset.target;
    grid.innerHTML = '';
    colors.forEach(function(hex) {
      var sw = document.createElement('div');
      sw.className = 'recent-color-swatch';
      sw.style.background = hex;
      sw.title = hex;
      sw.addEventListener('click', function() {
        var input = document.getElementById(targetId);
        if (!input) return;
        input.value = hex;
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      grid.appendChild(sw);
    });
  });
}
document.getElementById('replaceColor').addEventListener('change',  function(){ addRecentColor(this.value); });
document.getElementById('scpColorPicker').addEventListener('change', function(){ addRecentColor(this.value); });

// ── Right panel: text layer list ──────────────────────────────────────────────
function renderTextLayerList() {
  var list = document.getElementById('textLayerList');
  list.innerHTML = '';
  if (!st.textLayers.length) {
    list.innerHTML = '<div class="erp-empty">Nenhum texto adicionado.</div>';
    return;
  }
  st.textLayers.forEach(function(layer, idx) {
    var row = document.createElement('div');
    row.className = 'erp-layer-row' + (layer.id === st.selText ? ' selected' : '');

    var chip = document.createElement('div');
    chip.className = 'erp-color-chip';
    chip.style.background = layer.color;

    var label = document.createElement('div');
    label.className = 'erp-layer-label';
    label.textContent = layer.text || '(vazio)';
    var meta = document.createElement('span');
    meta.className = 'erp-layer-meta';
    meta.textContent = layer.font + ' · ' + layer.size + 'px';
    label.appendChild(meta);

    var actions = document.createElement('div');
    actions.className = 'erp-layer-actions';

    var up = document.createElement('button');
    up.className = 'erp-layer-move'; up.textContent = '▲'; up.title = 'Mover para cima';
    if (idx === 0) up.disabled = true;
    up.onclick = function(ev) { ev.stopPropagation(); moveTextLayer(idx, -1); };

    var down = document.createElement('button');
    down.className = 'erp-layer-move'; down.textContent = '▼'; down.title = 'Mover para baixo';
    if (idx === st.textLayers.length - 1) down.disabled = true;
    down.onclick = function(ev) { ev.stopPropagation(); moveTextLayer(idx, 1); };

    var del = document.createElement('button');
    del.className = 'erp-layer-del'; del.textContent = '×'; del.title = 'Excluir';
    del.onclick = function(ev) { ev.stopPropagation(); deleteTextLayer(layer.id); };

    actions.appendChild(up); actions.appendChild(down); actions.appendChild(del);
    row.appendChild(chip); row.appendChild(label); row.appendChild(actions);
    row.addEventListener('click', function() { selText(layer.id); });
    list.appendChild(row);
  });
}

function moveTextLayer(idx, dir) {
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= st.textLayers.length) return;
  var tmp = st.textLayers[idx];
  st.textLayers[idx] = st.textLayers[newIdx];
  st.textLayers[newIdx] = tmp;
  rebuildTextDOM();
  renderTextLayerList();
  saveLayers();
}

// ── Right panel collapse toggle ────────────────────────────────────────────────
var PANEL_COLLAPSED_KEY = 'imagetiler_editor_panel_v1';
var editorLayoutEl = document.querySelector('#tab-editor .editor-layout');
function setPanelCollapsed(collapsed) {
  editorLayoutEl.classList.toggle('panel-collapsed', collapsed);
  localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? '1' : '0');
  scheduleStageTransform();
}
document.getElementById('btnTogglePanel').addEventListener('click', function() {
  setPanelCollapsed(!editorLayoutEl.classList.contains('panel-collapsed'));
});

// ── Init ──────────────────────────────────────────────────────────────────────
setTool('color');
loadSystemFonts();
populatePresetSelect();
updateUndoBtns();
renderRecentColors();
renderTextLayerList();
setPanelCollapsed(localStorage.getItem(PANEL_COLLAPSED_KEY) === '1');
log('Editor pronto.');

})();
