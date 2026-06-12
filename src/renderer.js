// ── Global error catcher ───────────────────────────────────────────────────
window.addEventListener('error', ev => {
  const bar = document.getElementById('statusBar');
  if (bar) {
    bar.textContent = 'ERRO JS: ' + ev.message + ' (linha ' + ev.lineno + ')';
    bar.className = 'status-bar err';
  }
  console.error('Global error:', ev.message, ev.filename, ev.lineno);
});

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  imgEl: null,
  imgSrc: null,
  naturalW: 0,
  naturalH: 0,
  zoom: 0.75,
  lastPdfBytes: null,
  align: 'left',
  selectedPreset: null,
};

const PAGE_SIZES = { A4:[21,29.7], A3:[29.7,42], Letter:[21.59,27.94] };
const $ = id => document.getElementById(id);
const cm2px = cm => cm * 37.795275591;
const cm2pt = cm => cm * 28.346456693;

// ── Params ─────────────────────────────────────────────────────────────────
function getParams() {
  const fmt = $('pageFormat').value;
  const orient = $('pageOrient').value;
  let pw, ph;
  if (fmt === 'custom') {
    pw = parseFloat($('customW').value) || 21;
    ph = parseFloat($('customH').value) || 29.7;
  } else {
    [pw, ph] = PAGE_SIZES[fmt];
  }
  if (orient === 'landscape') [pw, ph] = [ph, pw];

  let imgW = parseFloat($('imgW').value) || 5;
  let imgH = parseFloat($('imgH').value) || 5;
  return {
    pageW: pw, pageH: ph,
    marginH: parseFloat($('marginH').value) || 0,
    marginV: parseFloat($('marginV').value) || 0,
    gapH: parseFloat($('gapH').value) || 0,
    gapV: parseFloat($('gapV').value) || 0,
    imgW, imgH,
    copies: Math.max(1, parseInt($('copies').value) || 1),
    align: state.align,
  };
}

function calcLayout(p) {
  const usableW = p.pageW - 2 * p.marginH;
  const usableH = p.pageH - 2 * p.marginV;
  if (usableW <= 0 || usableH <= 0 || p.imgW <= 0 || p.imgH <= 0) return null;
  const cols = Math.floor((usableW + p.gapH) / (p.imgW + p.gapH));
  const rows = Math.floor((usableH + p.gapV) / (p.imgH + p.gapV));
  if (cols < 1 || rows < 1) return null;
  const perPage = cols * rows;
  const pages = Math.ceil(p.copies / perPage);
  const gridW = cols * p.imgW + (cols - 1) * p.gapH;
  return { cols, rows, perPage, pages, gridW };
}

function alignOffset(p, lay) {
  const usableW = p.pageW - 2 * p.marginH;
  const spare = usableW - lay.gridW;
  if (p.align === 'center') return spare / 2;
  if (p.align === 'right')  return spare;
  return 0;
}

// ── UI helpers ─────────────────────────────────────────────────────────────
function setStatus(msg, type) {
  const el = $('statusBar');
  el.textContent = msg;
  el.className = 'status-bar' + (type ? ' ' + type : '');
}

function setLoading(on) {
  $('spinner').classList.toggle('visible', on);
  $('btnPreview').disabled = on || !state.imgEl;
  $('btnSave').disabled    = on || !state.imgEl;
  $('btnPrint').disabled   = on || !state.imgEl;
}

// ── Debounced render ───────────────────────────────────────────────────────
let _renderTimer = null;
function scheduleRender(immediate) {
  if (!state.imgEl) return;
  if (immediate) {
    if (_renderTimer) { clearTimeout(_renderTimer); _renderTimer = null; }
    renderPreview();
    return;
  }
  if (_renderTimer) clearTimeout(_renderTimer);
  _renderTimer = setTimeout(function() { _renderTimer = null; renderPreview(); }, 80);
}

// ── Draw one page on canvas ────────────────────────────────────────────────
function drawPage(canvas, p, lay, pageIndex, zoom, showGuides) {
  const ctx = canvas.getContext('2d');
  const cW = Math.round(cm2px(p.pageW) * zoom);
  const cH = Math.round(cm2px(p.pageH) * zoom);
  canvas.width = cW;
  canvas.height = cH;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cW, cH);

  const startIdx = pageIndex * lay.perPage;
  const count = Math.min(lay.perPage, p.copies - startIdx);
  const xOff = alignOffset(p, lay);

  for (var i = 0; i < count; i++) {
    var col = i % lay.cols;
    var row = Math.floor(i / lay.cols);
    var x = (p.marginH + xOff + col * (p.imgW + p.gapH)) * cm2px(1) * zoom;
    var y = (p.marginV + row * (p.imgH + p.gapV)) * cm2px(1) * zoom;
    ctx.drawImage(state.imgEl, x, y, p.imgW * cm2px(1) * zoom, p.imgH * cm2px(1) * zoom);
  }

  if (showGuides) {
    var mx = (p.marginH + xOff) * cm2px(1) * zoom;
    var my = p.marginV * cm2px(1) * zoom;

    if (p.gapH > 0) {
      ctx.fillStyle = 'rgba(255,153,38,0.13)';
      for (var c = 0; c < lay.cols - 1; c++) {
        var gx = mx + (c + 1) * p.imgW * cm2px(1) * zoom + c * p.gapH * cm2px(1) * zoom;
        var gw = p.gapH * cm2px(1) * zoom;
        ctx.fillRect(gx, my, gw, cH - 2 * my);
      }
    }
    if (p.gapV > 0) {
      ctx.fillStyle = 'rgba(255,153,38,0.13)';
      for (var r = 0; r < lay.rows - 1; r++) {
        var gy = my + (r + 1) * p.imgH * cm2px(1) * zoom + r * p.gapV * cm2px(1) * zoom;
        var gh = p.gapV * cm2px(1) * zoom;
        ctx.fillRect(mx, gy, lay.cols * p.imgW * cm2px(1) * zoom + (lay.cols - 1) * p.gapH * cm2px(1) * zoom, gh);
      }
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(255,153,38,0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    if (p.gapH > 0) {
      for (var c2 = 0; c2 < lay.cols - 1; c2++) {
        var gx2 = mx + (c2 + 1) * p.imgW * cm2px(1) * zoom + c2 * p.gapH * cm2px(1) * zoom + p.gapH * cm2px(1) * zoom / 2;
        ctx.beginPath(); ctx.moveTo(gx2, my); ctx.lineTo(gx2, cH - my); ctx.stroke();
      }
    }
    if (p.gapV > 0) {
      for (var r2 = 0; r2 < lay.rows - 1; r2++) {
        var gy2 = my + (r2 + 1) * p.imgH * cm2px(1) * zoom + r2 * p.gapV * cm2px(1) * zoom + p.gapV * cm2px(1) * zoom / 2;
        ctx.beginPath(); ctx.moveTo(mx, gy2); ctx.lineTo(mx + lay.cols * (p.imgW + p.gapH) * cm2px(1) * zoom - p.gapH * cm2px(1) * zoom, gy2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(0, 0, cW, cH);
}

// ── Build SVG guide overlay (outside canvas) ───────────────────────────────
function buildGuideOverlay(p, lay, zoom) {
  var cW = Math.round(cm2px(p.pageW) * zoom);
  var cH = Math.round(cm2px(p.pageH) * zoom);
  var mx = p.marginH * cm2px(1) * zoom;
  var my = p.marginV * cm2px(1) * zoom;

  // Extra space outside canvas for annotations
  var LEFT   = 52;  // room for vertical margin arrows on the left
  var RIGHT  = 90;  // room for legend box on the right
  var TOP    = 28;
  var BOTTOM = 36;  // room for gap label below

  var svgW = LEFT + cW + RIGHT;
  var svgH = TOP  + cH + BOTTOM;
  var ox = LEFT;   // canvas starts here in SVG coords
  var oy = TOP;

  var marginCol    = '#00810F';
  var marginPastel = '#7BC983';
  var textCol      = '#00810F';
  var gapCol       = '#FF9926';
  var xOff = alignOffset(p, lay) * cm2px(1) * zoom;

  var s = '';

  // ── Horizontal margin arrows (placed at 1/3 height, not centre, to avoid V arrows) ──
  if (p.marginH > 0) {
    var arrowY = oy + Math.round(cH * 0.35);

    // left margin arrow
    s += '<line x1="' + ox + '" y1="' + arrowY + '" x2="' + (ox+mx) + '" y2="' + arrowY + '" stroke="' + marginCol + '" stroke-width="1.5" stroke-dasharray="4 3"/>';
    s += '<polygon points="' + ox + ',' + (arrowY-4) + ' ' + ox + ',' + (arrowY+4) + ' ' + (ox-7) + ',' + arrowY + '" fill="' + marginCol + '"/>';
    s += '<polygon points="' + (ox+mx) + ',' + (arrowY-4) + ' ' + (ox+mx) + ',' + (arrowY+4) + ' ' + (ox+mx+7) + ',' + arrowY + '" fill="' + marginCol + '"/>';
    s += '<text x="' + (ox + mx/2) + '" y="' + (arrowY - 6) + '" text-anchor="middle" fill="' + textCol + '" font-family="monospace" font-size="9" font-weight="bold">' + p.marginH + 'cm</text>';

    // right margin arrow
    var rxStart = ox + cW - mx;
    s += '<line x1="' + rxStart + '" y1="' + arrowY + '" x2="' + (ox+cW) + '" y2="' + arrowY + '" stroke="' + marginCol + '" stroke-width="1.5" stroke-dasharray="4 3"/>';
    s += '<polygon points="' + (ox+cW) + ',' + (arrowY-4) + ' ' + (ox+cW) + ',' + (arrowY+4) + ' ' + (ox+cW+7) + ',' + arrowY + '" fill="' + marginCol + '"/>';
    s += '<polygon points="' + rxStart + ',' + (arrowY-4) + ' ' + rxStart + ',' + (arrowY+4) + ' ' + (rxStart-7) + ',' + arrowY + '" fill="' + marginCol + '"/>';
    s += '<text x="' + (rxStart + mx/2) + '" y="' + (arrowY - 6) + '" text-anchor="middle" fill="' + textCol + '" font-family="monospace" font-size="9" font-weight="bold">' + p.marginH + 'cm</text>';
  }

  // ── Vertical margin arrows (placed at x = ox-28, clear of canvas edge) ──
  if (p.marginV > 0) {
    var arrowX = ox - 28;

    // top margin
    s += '<line x1="' + arrowX + '" y1="' + oy + '" x2="' + arrowX + '" y2="' + (oy+my) + '" stroke="' + marginCol + '" stroke-width="1.5" stroke-dasharray="4 3"/>';
    s += '<polygon points="' + (arrowX-4) + ',' + oy + ' ' + (arrowX+4) + ',' + oy + ' ' + arrowX + ',' + (oy-7) + '" fill="' + marginCol + '"/>';
    s += '<polygon points="' + (arrowX-4) + ',' + (oy+my) + ' ' + (arrowX+4) + ',' + (oy+my) + ' ' + arrowX + ',' + (oy+my+7) + '" fill="' + marginCol + '"/>';
    s += '<text x="' + (arrowX - 4) + '" y="' + (oy + my/2) + '" text-anchor="middle" fill="' + textCol + '" font-family="monospace" font-size="9" font-weight="bold" transform="rotate(-90,' + (arrowX-4) + ',' + (oy+my/2) + ')">' + p.marginV + 'cm</text>';

    // bottom margin
    var byStart = oy + cH - my;
    s += '<line x1="' + arrowX + '" y1="' + byStart + '" x2="' + arrowX + '" y2="' + (oy+cH) + '" stroke="' + marginCol + '" stroke-width="1.5" stroke-dasharray="4 3"/>';
    s += '<polygon points="' + (arrowX-4) + ',' + byStart + ' ' + (arrowX+4) + ',' + byStart + ' ' + arrowX + ',' + (byStart-7) + '" fill="' + marginCol + '"/>';
    s += '<polygon points="' + (arrowX-4) + ',' + (oy+cH) + ' ' + (arrowX+4) + ',' + (oy+cH) + ' ' + arrowX + ',' + (oy+cH+7) + '" fill="' + marginCol + '"/>';
    s += '<text x="' + (arrowX - 4) + '" y="' + (byStart + my/2) + '" text-anchor="middle" fill="' + textCol + '" font-family="monospace" font-size="9" font-weight="bold" transform="rotate(-90,' + (arrowX-4) + ',' + (byStart+my/2) + ')">' + p.marginV + 'cm</text>';
  }

  // Dashed margin border (always fixed to page margins)
  s += '<rect x="' + (ox+mx) + '" y="' + (oy+my) + '" width="' + (cW-2*mx) + '" height="' + (cH-2*my) + '" fill="none" stroke="' + marginPastel + '" stroke-opacity="0.6" stroke-width="1" stroke-dasharray="6 4"/>';

  // ── Gap annotation below page ──
  if ((p.gapH > 0 || p.gapV > 0) && lay.cols > 1) {
    var algOff = alignOffset(p, lay);
    var gx1 = ox + (p.marginH + algOff + p.imgW) * cm2px(1) * zoom;
    var gx2 = gx1 + p.gapH * cm2px(1) * zoom;
    var labelY = oy + cH + 16;
    s += '<line x1="' + gx1 + '" y1="' + labelY + '" x2="' + gx2 + '" y2="' + labelY + '" stroke="' + gapCol + '" stroke-width="1.5"/>';
    s += '<polygon points="' + gx1 + ',' + (labelY-3) + ' ' + gx1 + ',' + (labelY+3) + ' ' + (gx1-6) + ',' + labelY + '" fill="' + gapCol + '"/>';
    s += '<polygon points="' + gx2 + ',' + (labelY-3) + ' ' + gx2 + ',' + (labelY+3) + ' ' + (gx2+6) + ',' + labelY + '" fill="' + gapCol + '"/>';
    s += '<text x="' + ((gx1+gx2)/2) + '" y="' + (labelY + 10) + '" text-anchor="middle" fill="' + gapCol + '" font-family="monospace" font-size="9" font-weight="bold">espaco ' + p.gapH + 'cm</text>';
  }

  // ── Legend box (top-right, outside page) ──
  var lx = ox + cW + 8;
  var ly = oy + 4;
  var legH = (p.gapH > 0 || p.gapV > 0) ? 38 : 22;
  s += '<rect x="' + lx + '" y="' + ly + '" width="76" height="' + legH + '" rx="3" fill="#111" stroke="#333" stroke-width="1"/>';
  s += '<line x1="' + (lx+6) + '" y1="' + (ly+11) + '" x2="' + (lx+18) + '" y2="' + (ly+11) + '" stroke="' + marginCol + '" stroke-width="1.5" stroke-dasharray="4 3"/>';
  s += '<text x="' + (lx+22) + '" y="' + (ly+14) + '" fill="' + marginCol + '" font-family="monospace" font-size="9" font-weight="bold">margem</text>';
  if (p.gapH > 0 || p.gapV > 0) {
    s += '<line x1="' + (lx+6) + '" y1="' + (ly+27) + '" x2="' + (lx+18) + '" y2="' + (ly+27) + '" stroke="' + gapCol + '" stroke-width="1.5" stroke-dasharray="4 3"/>';
    s += '<text x="' + (lx+22) + '" y="' + (ly+30) + '" fill="' + gapCol + '" font-family="monospace" font-size="9" font-weight="bold">espaco</text>';
  }

  return { svgW: svgW, svgH: svgH, svgContent: s, offsetX: -LEFT, offsetY: -TOP };
}

// ── Render all pages ───────────────────────────────────────────────────────
function renderPreview() {
  if (!state.imgEl) return;
  var p = getParams();
  var lay = calcLayout(p);
  var wrapper = $('canvasWrapper');
  var showGuides = $('showGuides').checked;

  wrapper.innerHTML = '';

  if (!lay) {
    setStatus('Imagem nao cabe na folha com as margens informadas.', 'err');
    var es = document.createElement('div');
    es.className = 'empty-state';
    es.innerHTML = '<p style="color:#FF9926">&#9888; Imagem nao cabe na folha.</p>';
    wrapper.appendChild(es);
    return;
  }

  var zoom = state.zoom;

  for (var pg = 0; pg < lay.pages; pg++) {
    var outer = document.createElement('div');
    outer.className = 'page-outer';

    var canvasWrap = document.createElement('div');
    canvasWrap.className = 'page-canvas-wrap';

    var cvs = document.createElement('canvas');
    drawPage(cvs, p, lay, pg, zoom, showGuides);
    canvasWrap.appendChild(cvs);

    if (showGuides) {
      var g = buildGuideOverlay(p, lay, zoom);
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', g.svgW);
      svg.setAttribute('height', g.svgH);
      svg.classList.add('guide-overlay-svg');
      svg.style.left = g.offsetX + 'px';
      svg.style.top  = g.offsetY + 'px';
      svg.innerHTML = g.svgContent;
      canvasWrap.appendChild(svg);
      canvasWrap.style.margin = '28px 90px 36px 52px';
    } else {
      canvasWrap.style.margin = '0';
    }

    outer.appendChild(canvasWrap);

    if (lay.pages > 1) {
      var lbl = document.createElement('div');
      lbl.className = 'page-label';
      var s = pg * lay.perPage + 1;
      var e = Math.min((pg + 1) * lay.perPage, p.copies);
      lbl.textContent = 'Pagina ' + (pg+1) + ' de ' + lay.pages + ' — copias ' + s + '–' + e;
      outer.appendChild(lbl);
    }

    wrapper.appendChild(outer);
  }

  $('badgeInfo').textContent = lay.cols + 'x' + lay.rows + '/folha · ' + lay.pages + ' pag · ' + p.copies + ' copias';
  setStatus(
    lay.pages > 1
      ? lay.pages + ' paginas · ' + p.copies + ' copias · ' + lay.perPage + ' por folha'
      : p.copies + (p.copies > 1 ? ' copias' : ' copia') + ' em 1 folha (' + lay.cols + 'x' + lay.rows + ')',
    'ok'
  );
  $('btnSave').disabled  = false;
  $('btnPrint').disabled = false;
}

// ── PDF Generation ─────────────────────────────────────────────────────────
async function generatePDF() {
  if (!state.imgEl || !state.imgSrc) return null;
  var p   = getParams();
  var lay = calcLayout(p);
  if (!lay) return null;

  var pdfDoc = await PDFLib.PDFDocument.create();
  var offscreen = document.createElement('canvas');
  offscreen.width  = state.naturalW;
  offscreen.height = state.naturalH;
  offscreen.getContext('2d').drawImage(state.imgEl, 0, 0);
  var pngBase64 = offscreen.toDataURL('image/png').split(',')[1];
  var pngBytes  = Uint8Array.from(atob(pngBase64), function(c) { return c.charCodeAt(0); });
  var pdfImg    = await pdfDoc.embedPng(pngBytes);

  var pw = cm2pt(p.pageW), ph = cm2pt(p.pageH);
  var imgWpt = cm2pt(p.imgW), imgHpt = cm2pt(p.imgH);
  var xOff = alignOffset(p, lay);

  var placed = 0, page = null;
  for (var i = 0; i < p.copies; i++) {
    if (placed % lay.perPage === 0) page = pdfDoc.addPage([pw, ph]);
    var pos = placed % lay.perPage;
    var col = pos % lay.cols;
    var row = Math.floor(pos / lay.cols);
    var x = cm2pt(p.marginH + xOff + col * (p.imgW + p.gapH));
    var y = ph - cm2pt(p.marginV) - (row + 1) * imgHpt - row * cm2pt(p.gapV);
    page.drawImage(pdfImg, { x: x, y: y, width: imgWpt, height: imgHpt });
    placed++;
  }
  return await pdfDoc.save();
}

// ── Zoom ───────────────────────────────────────────────────────────────────
function fitZoom() {
  var wrapper = $('canvasWrapper');
  var p = getParams();
  var availW = wrapper.clientWidth  - 120;
  var availH = wrapper.clientHeight - 80;
  state.zoom = Math.min(availW / cm2px(p.pageW), availH / cm2px(p.pageH), 1);
  $('zoomLabel').textContent = Math.round(state.zoom * 100) + '%';
}

// ── Alignment buttons ──────────────────────────────────────────────────────
document.querySelectorAll('.align-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.align-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    state.align = btn.dataset.align;
    if (state.imgEl) scheduleRender(true);
  });
});

// ── Presets ────────────────────────────────────────────────────────────────
var PRESETS_KEY = 'imagetiler_presets_v1';

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || {}; }
  catch(e) { return {}; }
}

function savePresets(data) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(data));
}

function collectCurrentConfig() {
  return {
    imgW: $('imgW').value, imgH: $('imgH').value,
    pageFormat: $('pageFormat').value,
    customW: $('customW').value, customH: $('customH').value,
    pageOrient: $('pageOrient').value,
    marginH: $('marginH').value, marginV: $('marginV').value,
    gapH: $('gapH').value, gapV: $('gapV').value,
    copies: $('copies').value,
    align: state.align,
  };
}

function applyConfig(cfg) {
  if (!cfg) return;
  ['imgW','imgH','pageFormat','customW','customH','pageOrient',
   'marginH','marginV','gapH','gapV','copies'].forEach(function(k) {
    var el = $(k);
    if (el && cfg[k] !== undefined) el.value = cfg[k];
  });
  $('customPageSize').classList.toggle('visible', cfg.pageFormat === 'custom');
  if (cfg.align) {
    state.align = cfg.align;
    document.querySelectorAll('.align-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.align === cfg.align);
    });
  }
  if (state.imgEl) scheduleRender(true);
}

// ── Preset dropdown ────────────────────────────────────────────────────────
var dropdownOpen = false;

function openDropdown() {
  dropdownOpen = true;
  var trigger = $('presetTrigger');
  var rect = trigger.getBoundingClientRect();
  var dd = $('presetDropdown');
  dd.style.top   = (rect.bottom + 4) + 'px';
  dd.style.left  = rect.left + 'px';
  dd.style.width = rect.width + 'px';
  dd.classList.add('open');
  trigger.classList.add('open');
  renderPresetList();
}

function closeDropdown() {
  dropdownOpen = false;
  $('presetDropdown').classList.remove('open');
  $('presetTrigger').classList.remove('open');
  hideNewRow();
}

$('presetTrigger').addEventListener('click', function(e) {
  e.stopPropagation();
  if (dropdownOpen) { closeDropdown(); } else { openDropdown(); }
});

document.addEventListener('click', function(e) {
  if (!dropdownOpen) return;
  var dd = $('presetDropdown');
  var tr = $('presetTrigger');
  if (!dd.contains(e.target) && e.target !== tr) closeDropdown();
});

function showNewRow() {
  $('presetNewRow').classList.add('visible');
  $('presetAddRow').style.display = 'none';
  $('presetNewName').value = '';
  $('presetNewName').focus();
}

function hideNewRow() {
  $('presetNewRow').classList.remove('visible');
  $('presetAddRow').style.display = '';
}

$('presetAddRow').addEventListener('click', function(e) {
  e.stopPropagation();
  showNewRow();
});

function commitNewPreset() {
  var name = $('presetNewName').value.trim();
  if (!name) return;
  var presets = loadPresets();
  presets[name] = collectCurrentConfig();
  savePresets(presets);
  state.selectedPreset = name;
  $('presetTriggerLabel').textContent = name;
  setStatus('Preset "' + name + '" criado.', 'ok');
  closeDropdown();
}

$('presetNewSave').addEventListener('click', function(e) {
  e.stopPropagation();
  commitNewPreset();
});

$('presetNewName').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); commitNewPreset(); }
  if (e.key === 'Escape') hideNewRow();
});

function renderPresetList() {
  var list = $('presetList');
  list.innerHTML = '';
  var presets = loadPresets();
  var names = Object.keys(presets);
  if (names.length === 0) {
    list.innerHTML = '<div style="padding:10px 12px;font-size:11px;color:var(--muted);font-family:monospace;">Nenhum preset salvo</div>';
    return;
  }
  names.forEach(function(name) {
    var item = document.createElement('div');
    item.className = 'preset-item' + (name === state.selectedPreset ? ' selected' : '');

    var nameEl = document.createElement('span');
    nameEl.className = 'pi-name';
    nameEl.textContent = name;
    nameEl.title = name;

    var delBtn = document.createElement('button');
    delBtn.className = 'pi-del';
    delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>';
    delBtn.title = 'Excluir "' + name + '"';
    delBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var p2 = loadPresets();
      delete p2[name];
      savePresets(p2);
      if (state.selectedPreset === name) {
        state.selectedPreset = null;
        $('presetTriggerLabel').textContent = 'Selecionar preset…';
      }
      setStatus('Preset "' + name + '" excluido.', 'ok');
      renderPresetList();
    });

    item.appendChild(nameEl);
    item.appendChild(delBtn);
    item.addEventListener('click', function() {
      var fresh = loadPresets();
      applyConfig(fresh[name]);
      state.selectedPreset = name;
      $('presetTriggerLabel').textContent = name;
      closeDropdown();
    });
    list.appendChild(item);
  });
}

$('btnSavePreset').addEventListener('click', function() {
  if (state.selectedPreset) {
    var presets = loadPresets();
    presets[state.selectedPreset] = collectCurrentConfig();
    savePresets(presets);
    setStatus('Preset "' + state.selectedPreset + '" atualizado.', 'ok');
  } else {
    $('inlinePrompt').classList.add('visible');
    $('inlinePresetName').value = '';
    $('inlinePresetName').focus();
  }
});

$('ipCancel').addEventListener('click', function() {
  $('inlinePrompt').classList.remove('visible');
});

function commitInlinePreset() {
  var name = $('inlinePresetName').value.trim();
  if (!name) return;
  var presets = loadPresets();
  presets[name] = collectCurrentConfig();
  savePresets(presets);
  state.selectedPreset = name;
  $('presetTriggerLabel').textContent = name;
  $('inlinePrompt').classList.remove('visible');
  setStatus('Preset "' + name + '" salvo.', 'ok');
}

$('ipConfirm').addEventListener('click', commitInlinePreset);
$('inlinePresetName').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') commitInlinePreset();
  if (e.key === 'Escape') $('inlinePrompt').classList.remove('visible');
});

// ── Image loading ──────────────────────────────────────────────────────────
function loadImage(file) {
  if (!file || !file.type.startsWith('image/')) {
    setStatus('Arquivo invalido. Selecione uma imagem.', 'err');
    return;
  }
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      state.imgEl    = img;
      state.imgSrc   = e.target.result;
      state.naturalW = img.naturalWidth;
      state.naturalH = img.naturalHeight;
      state.lastPdfBytes = null;

      var thumb = $('dropThumb');
      thumb.src = e.target.result;
      thumb.classList.add('visible');

      if (state.selectedPreset) {
        // keep preset dimensions
      } else {
        var dw = img.naturalWidth  / 37.795275591;
        var dh = img.naturalHeight / 37.795275591;
        $('imgW').value = dw.toFixed(2);
        $('imgH').value = dh.toFixed(2);
      }

      $('btnPreview').disabled = false;
      setStatus(img.naturalWidth + 'x' + img.naturalHeight + 'px carregado', 'ok');
      fitZoom();
      scheduleRender(true);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Event wiring ───────────────────────────────────────────────────────────
$('fileInput').addEventListener('change', function(e) {
  loadImage(e.target.files[0]);
});

var dz = $('dropZone');
dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', function() { dz.classList.remove('drag-over'); });
dz.addEventListener('drop', function(e) {
  e.preventDefault();
  dz.classList.remove('drag-over');
  loadImage(e.dataTransfer.files[0]);
});

$('btnPreview').addEventListener('click', function() { fitZoom(); scheduleRender(true); });
$('showGuides').addEventListener('change', function() { if (state.imgEl) scheduleRender(true); });

$('pageFormat').addEventListener('change', function() {
  $('customPageSize').classList.toggle('visible', $('pageFormat').value === 'custom');
  if (state.imgEl) scheduleRender(true);
});

['imgW','imgH','pageOrient','marginH','marginV','gapH','gapV','copies','customW','customH'].forEach(function(id) {
  $(id).addEventListener('change', function() { if (state.imgEl) scheduleRender(true); });
});

$('imgW').addEventListener('input', function() { if (state.imgEl) scheduleRender(); });
$('imgH').addEventListener('input', function() { if (state.imgEl) scheduleRender(); });

$('btnZoomIn').addEventListener('click', function() {
  state.zoom = Math.min(state.zoom + 0.1, 2);
  $('zoomLabel').textContent = Math.round(state.zoom * 100) + '%';
  scheduleRender(true);
});
$('btnZoomOut').addEventListener('click', function() {
  state.zoom = Math.max(state.zoom - 0.1, 0.1);
  $('zoomLabel').textContent = Math.round(state.zoom * 100) + '%';
  scheduleRender(true);
});
$('btnZoomFit').addEventListener('click', function() { fitZoom(); scheduleRender(true); });

$('btnSave').addEventListener('click', async function() {
  setLoading(true); setStatus('Gerando PDF…');
  try {
    var bytes = await generatePDF();
    if (!bytes) { setStatus('Erro ao gerar PDF.', 'err'); setLoading(false); return; }
    state.lastPdfBytes = bytes;
    var result = await window.electronAPI.savePDF(Array.from(bytes));
    setStatus(result.success ? 'Salvo: ' + result.filePath : 'Cancelado.', result.success ? 'ok' : '');
  } catch(err) { setStatus('Erro: ' + err.message, 'err'); }
  setLoading(false);
  $('btnSave').disabled  = false;
  $('btnPrint').disabled = false;
});

$('btnPrint').addEventListener('click', async function() {
  setLoading(true); setStatus('Gerando PDF para impressao…');
  try {
    var bytes = state.lastPdfBytes || await generatePDF();
    if (!bytes) { setStatus('Erro ao gerar PDF.', 'err'); setLoading(false); return; }
    state.lastPdfBytes = bytes;
    // Timeout safety: se demorar mais de 8s, libera a UI de qualquer forma
    var done = false;
    var timer = setTimeout(function() {
      if (!done) { done = true; setLoading(false); $('btnSave').disabled = false; $('btnPrint').disabled = false; }
    }, 8000);
    var result = await window.electronAPI.printPDF(Array.from(bytes));
    done = true; clearTimeout(timer);
    if (result.success) {
      setStatus('Impressao enviada.', 'ok');
    } else {
      setStatus('Impressao: ' + (result.error || 'cancelada.'), '');
    }
  } catch(err) {
    setStatus('Erro: ' + err.message, 'err');
  }
  setLoading(false);
  $('btnSave').disabled  = false;
  $('btnPrint').disabled = false;
});

$('btnClear').addEventListener('click', function() {
  state.imgEl = null; state.imgSrc = null; state.lastPdfBytes = null;
  $('fileInput').value = '';
  $('dropThumb').src = '';
  $('dropThumb').classList.remove('visible');
  $('canvasWrapper').innerHTML = '<div class="empty-state"><p style="color:var(--muted)">Selecione uma imagem e configure os parametros</p></div>';
  $('btnPreview').disabled = $('btnSave').disabled = $('btnPrint').disabled = true;
  $('badgeInfo').textContent = '— sem imagem —';
  setStatus('');
});

// ── Image preview modal ──────────────────────────────────────────────────
var ipvZoomLevel = 1;
const IPV_ZOOM_MIN = 0.25, IPV_ZOOM_MAX = 4, IPV_ZOOM_STEP = 0.25;

function ipvApplyZoom() {
  $('imagePreviewImg').style.transform = 'scale(' + ipvZoomLevel + ')';
  $('ipvZoomLabel').textContent = Math.round(ipvZoomLevel * 100) + '%';
}

function openImagePreview() {
  var src = $('dropThumb').src;
  if (!src) return;
  $('imagePreviewImg').src = src;
  ipvZoomLevel = 1;
  ipvApplyZoom();
  $('imagePreviewOverlay').classList.add('visible');
}

function closeImagePreview() {
  $('imagePreviewOverlay').classList.remove('visible');
}

$('dropThumb').addEventListener('click', function() {
  if ($('dropThumb').classList.contains('visible')) openImagePreview();
});
$('imagePreviewClose').addEventListener('click', closeImagePreview);
$('imagePreviewOverlay').addEventListener('click', function(e) {
  if (e.target === $('imagePreviewOverlay')) closeImagePreview();
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && $('imagePreviewOverlay').classList.contains('visible')) closeImagePreview();
});
$('ipvZoomIn').addEventListener('click', function() {
  ipvZoomLevel = Math.min(ipvZoomLevel + IPV_ZOOM_STEP, IPV_ZOOM_MAX);
  ipvApplyZoom();
});
$('ipvZoomOut').addEventListener('click', function() {
  ipvZoomLevel = Math.max(ipvZoomLevel - IPV_ZOOM_STEP, IPV_ZOOM_MIN);
  ipvApplyZoom();
});
$('ipvZoomFit').addEventListener('click', function() {
  ipvZoomLevel = 1;
  ipvApplyZoom();
});

// ── Update checker ───────────────────────────────────────────────────────
if (window.electronAPI.checkForUpdates) {
  window.electronAPI.checkForUpdates().then(function(res) {
    if (res.currentVersion) $('appVersion').textContent = 'v' + res.currentVersion;
    if (res.success && res.hasUpdate) {
      var btn = $('btnUpdate');
      btn.title = 'Nova versão disponível: v' + res.latestVersion + ' (atual: v' + res.currentVersion + ')';
      btn.classList.add('visible');
      btn.addEventListener('click', function() {
        window.electronAPI.openExternal(res.url);
      });
    }
  }).catch(function() {});
}

// ── Init ───────────────────────────────────────────────────────────────────
renderPresetList();
console.log('renderer.js carregado OK');

// ── Bridge: load image from Editor de Matriz ───────────────────────────────
window._tilerLoadImageFromDataUrl = function(dataUrl, imgEl) {
  state.imgEl    = imgEl;
  state.imgSrc   = dataUrl;
  state.naturalW = imgEl.naturalWidth;
  state.naturalH = imgEl.naturalHeight;
  state.lastPdfBytes = null;

  var thumb = $('dropThumb');
  thumb.src = dataUrl;
  thumb.classList.add('visible');

  if (!state.selectedPreset) {
    var dw = imgEl.naturalWidth  / 37.795275591;
    var dh = imgEl.naturalHeight / 37.795275591;
    $('imgW').value = dw.toFixed(2);
    $('imgH').value = dh.toFixed(2);
  }

  $('btnPreview').disabled = false;
  setStatus('Imagem recebida do Editor de Matriz.', 'ok');
  fitZoom();
  scheduleRender(true);
};

// ── Bridge: apply a preset by name from Editor de Matriz ───────────────────
window._tilerApplyPreset = function(presetName, cfg) {
  if (!cfg) return;
  // Apply config fields
  ['imgW','imgH','pageFormat','customW','customH','pageOrient',
   'marginH','marginV','gapH','gapV','copies'].forEach(function(k) {
    var el = $(k); if (el && cfg[k] !== undefined) el.value = cfg[k];
  });
  $('customPageSize').classList.toggle('visible', cfg.pageFormat === 'custom');
  if (cfg.align) {
    state.align = cfg.align;
    document.querySelectorAll('.align-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.align === cfg.align);
    });
  }
  // Mark preset as selected in dropdown
  state.selectedPreset = presetName;
  var label = $('presetTriggerLabel');
  if (label) label.textContent = presetName;
};
