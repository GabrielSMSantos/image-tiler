# SKILL.md — Image Tiler (Electron App)

## O que é este projeto

App desktop Electron pessoal para impressão de imagens em grade. Duas abas: **Tiler** (distribui imagens numa folha para PDF/impressão) e **Editor de Matriz** (edita templates SVG/raster com troca de cor e texto).

---

## Antes de qualquer edição

1. Leia os arquivos que vai modificar com `view`
2. Valide sintaxe com `node --check <arquivo>` após cada edição
3. Para mudanças não triviais, prefira reescrita completa do arquivo validada com `node --check` antes de entregar
4. Edições parciais com `str_replace` já quebraram o app múltiplas vezes — use com cuidado

---

## Estrutura de arquivos

```
~/image-tiler/
├── main.js           — processo principal (IPC, filesystem, BrowserWindow)
├── preload.js        — bridge IPC (contextBridge + webUtils para File path)
├── package.json      — electron ^36 / pdf-lib ^1.17 / electron-builder
├── matrizes/         — dados persistidos: <id>.svg|png|jpg + <id>.json
└── src/
    ├── index.html    — HTML + CSS das duas abas (580 linhas)
    ├── renderer.js   — lógica do Tiler (785 linhas)
    └── editor.js     — lógica do Editor de Matriz (927 linhas)
```

---

## Configuração Electron crítica

```js
// main.js — DEVE estar antes de app.whenReady()
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

// BrowserWindow webPreferences
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false,         // necessário para webUtils no preload
  preload: path.join(__dirname, 'preload.js')
}
```

**NÃO adicionar `--disable-software-rasterizer`** — isso derruba o único renderer disponível em ambientes sem GPU.

---

## IPC — todos os canais registrados

| Canal | Args | Retorno |
|-------|------|---------|
| `save-pdf` | `Uint8Array` | `{ success, filePath? }` |
| `print-pdf` | `Uint8Array` | `{ success, error? }` |
| `list-matrices` | — | `{ success, matrices[] }` |
| `save-matrix` | `{ id, name, srcPath, layers }` | `{ success }` |
| `update-matrix-layers` | `{ id, layers }` | `{ success }` |
| `save-svg-content` | `{ id, svgContent }` | `{ success }` |
| `update-matrix-meta` | `{ id, presetName }` | `{ success }` |
| `delete-matrix` | `{ id }` | `{ success }` |
| `read-matrix-image` | `{ id }` | `{ success, format, svgText? imageBase64? }` |
| `check-for-updates` | — | `{ success, currentVersion, latestVersion?, hasUpdate?, url?, error? }` |
| `open-external` | `url` (precisa começar com `https://github.com/GabrielSMSantos/image-tiler`) | `{ success, error? }` |

**NUNCA registrar o mesmo canal duas vezes** — Electron lança exceção fatal na inicialização.

---

## preload.js — padrões obrigatórios

### Obter caminho real de File object (Electron 32+)

`File.path` foi removido. `contextBridge` clona argumentos — File objects perdem identidade ao cruzar o bridge. Solução implementada:

```js
// preload.js registra listener no input DO DOM (contexto compartilhado)
// onde webUtils está disponível
input.addEventListener('change', function() {
  var p = webUtils.getPathForFile(input.files[0]);
  filePathCache.set('matrix', p);
});
// renderer chama:
window.electronAPI.getMatrixFilePath() // retorna string do path
```

### NÃO usar no preload

- `require('fs')`, `require('path')`, `require('os')` — não disponíveis com `sandbox: false` em alguns contextos
- `window.x = algo` para expor ao renderer — com `contextIsolation`, o `window` do preload é isolado do renderer

---

## renderer.js — Aba Tiler

### Estado global

```js
var state = {
  imgEl, imgSrc, naturalW, naturalH,  // imagem carregada
  align,           // 'left'|'center'|'right'
  selectedPreset,  // nome do preset ativo
  lastPdfBytes,    // Uint8Array do último PDF gerado
  zoom,            // fator de zoom do preview (0.25–3.0)
  pages            // array de { canvas, svgOverlay }
};
```

### Funções de bridge (expostas em window)

```js
window._tilerLoadImageFromDataUrl(dataUrl, imgEl)
// Carrega imagem do Editor — preenche state, atualiza thumb, dispara render

window._tilerApplyPreset(presetName, cfg)
// Aplica preset do Editor — preenche todos os campos do formulário
```

### Geração de PDF

Usa `pdf-lib` carregado via CDN. Conversão de cm para pontos: `cm * 28.346456693`.

### Dropdown de preset

Usa `position: fixed` com coords de `getBoundingClientRect()`. O sidebar tem `overflow-y: auto` que cria contexto de clipping — `position: absolute` seria aprisionado.

### Presets — localStorage

```js
const PRESETS_KEY = 'imagetiler_presets_v1';
// Estrutura: { [nome]: { imgW, imgH, pageFormat, customW, customH,
//                        pageOrient, marginH, marginV, gapH, gapV, copies, align } }
```

---

## editor.js — Aba Editor de Matriz

### Estado global

```js
var st = {
  matrix,       // { id, name, format, layers, svgContent, presetName }
  format,       // 'svg' | 'raster'
  baseData,     // ImageData atual (raster)
  origData,     // ImageData original sem edições (raster)
  undoStack,    // [{ baseData, colorLayers, textLayers }] para raster
  redoStack,
  svgDoc,       // elemento <svg> vivo no DOM
  svgHistory,   // [outerHTML string] para SVG
  svgRedo,
  textLayers,   // [{ id, type:'text', text, font, size, color, bold, x, y }]
  selText,      // id do texto selecionado
  editingText,  // id do texto em edição inline
  tool,         // 'none'|'color'|'text'
  pendingFile,  // File object aguardando confirmação de nome
};
```

### Padrão de troca de cor SVG

```js
var svgSelectedEl = null;
var svgSelectedOrigColor = null; // cor no momento do clique (referência para "aplicar a todas")

// scpApply — só o elemento clicado:
svgSelectedEl.setAttribute('fill', newColor);
svgSelectedEl.style.fill = newColor;

// scpApplyAll — todos com a mesma cor original:
// usa svgSelectedOrigColor como referência, NÃO a cor atual do picker
allFillable.forEach(el => {
  if (normalizeColorToHex(el.getAttribute('fill')) === svgSelectedOrigColor) { ... }
});
```

### Compound paths — SVG do ChatGPT/DALL-E

SVGs dessas ferramentas empacotam múltiplos subpaths num único `<path d="M...Z M...Z">`. Ao abrir pela primeira vez, `splitCompoundPaths()` divide em elementos separados:

```js
// Detecta subpaths por split em 'M'/'m' após 'Z'/'z'
// Cria um <path> novo por subpath, remove o original
// Resultado salvo em svgContent para não re-processar
```

### Posicionamento de texto

`layer.x/y` são coordenadas relativas ao canto superior esquerdo do canvas/SVG **exibido**. Para posicionar o `div` overlay:

```js
el.style.left = (canvasRect.left - areaRect.left + layer.x) + 'px';
el.style.top  = (canvasRect.top  - areaRect.top  + layer.y) + 'px';
```

**Capturar `canvasRect` e `areaRect` UMA VEZ no início do drag** — não a cada `mousemove`. Recomputar no mousemove causa o bug de pulo.

### Texto pulando ao trocar de aba

O painel editor tem `display:none` quando a aba está inativa. `getBoundingClientRect()` retorna zero nesse estado. Fix obrigatório:

```js
// Na troca para aba editor:
requestAnimationFrame(() => {
  requestAnimationFrame(() => { rebuildTextDOM(); });
});
```

### ResizeObserver para reposicionamento

```js
var ro = new ResizeObserver(() => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(rebuildTextDOM, 60);
});
ro.observe(document.getElementById('editorCanvasArea'));
```

### Export pixel-perfect para Tiler

```js
// Canvas com tamanho do elemento exibido (offsetWidth/offsetHeight)
// Para SVG: XMLSerializer → Blob → drawImage (preserva edições de cor do DOM)
// Para raster: putImageData do baseData
// Texto: fillText com layer.x/y direto (sem escala — mesmo espaço de coords)
```

---

## CSS — armadilhas conhecidas

| Problema | Causa | Fix |
|----------|-------|-----|
| Dropdown de preset clipado | `overflow: auto` no sidebar cria contexto de clipping | `position: fixed` + `getBoundingClientRect()` |
| Canvas não renderiza | `contain: layout style` | Remover completamente |
| Textos aprisionados no container | `overflow: hidden` no wrapper | Usar `overflow: visible` ou mover textos para fora |
| Gallery sem scroll | `overflow-y: auto` sem `min-height: 0` no flex | Adicionar `min-height: 0` |

---

## JSON da matriz — estrutura completa

```json
{
  "name": "string",
  "format": "svg | raster",
  "layers": [
    { "type": "color", "fromColor": "#rrggbb", "toColor": "#rrggbb", "tolerance": 40 },
    { "type": "text", "id": "uid", "text": "...", "font": "Arial",
      "size": 32, "color": "#ffffff", "bold": false, "x": 0, "y": 0 }
  ],
  "svgContent": "string | null",
  "presetName": "string | null",
  "createdAt": 1749600000000
}
```

---

## Checklist antes de entregar

- [ ] `node --check` em todos os arquivos JS modificados
- [ ] Nenhum canal IPC duplicado no `main.js`
- [ ] `sandbox: false` presente nas webPreferences
- [ ] `app.disableHardwareAcceleration()` antes de `app.whenReady()`
- [ ] `--disable-software-rasterizer` ausente (derruba o renderer)
- [ ] Sem `require('fs')` no `preload.js`
- [ ] Sem `window.x = algo` no preload (invisível ao renderer com contextIsolation)
- [ ] Sem `contain: layout style` no CSS
