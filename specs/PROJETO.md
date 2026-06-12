# Image Tiler — Documentação do Projeto

## Visão Geral

Image Tiler é um aplicativo desktop pessoal construído com Electron para automatizar a impressão de imagens em múltiplas cópias numa folha. O fluxo principal é: importar uma imagem de template (matriz), editar as cores e adicionar textos, e depois configurar como ela será distribuída na folha para impressão ou exportação em PDF.

O app tem duas abas principais: **Tiler** e **Editor de Matriz**.

---

## Stack e Configuração

- **Electron 42.3.3** com `contextIsolation: true`, `sandbox: false`, `nodeIntegration: false`
- **pdf-lib 1.17.1** para geração de PDF (carregado via CDN no HTML)
- **Node.js** no processo main para acesso ao filesystem
- Deploy alvo: Windows (build via electron-builder)
- Pasta do projeto: `~/image-tiler/`

### Estrutura de arquivos

```
image-tiler/
├── main.js           — processo principal Electron (IPC handlers, filesystem)
├── preload.js        — bridge segura entre main e renderer
├── package.json
├── assets/
│   ├── icon.ico
│   └── icon.png
├── matrizes/         — pasta de dados persistidos (criada automaticamente)
│   ├── <id>.svg ou .png/.jpg
│   └── <id>.json     — metadados: name, format, layers, svgContent, presetName
└── src/
    ├── index.html    — estrutura HTML + CSS das duas abas
    ├── renderer.js   — lógica da aba Tiler
    └── editor.js     — lógica da aba Editor de Matriz
```

### Scripts

```bash
npm start          # rodar em desenvolvimento
npm run build      # gerar .exe instalador para Windows
npm run build-portable  # gerar .exe portátil para Windows
```

---

## Configuração Electron (WSL2 / Linux)

O app precisa das seguintes flags para funcionar em ambientes sem GPU (WSL2, VMs):

```js
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
```

Sem essas flags no WSL2 o Electron entra em "Copy Mode" e a janela abre mas não renderiza.

---

## Aba Tiler

**Arquivo:** `src/renderer.js` (785 linhas)

### Funcionalidade

Recebe uma imagem (da galeria de matrizes ou upload direto) e a distribui em grade numa folha de impressão configurável. Gera preview ao vivo, exporta PDF e aciona o diálogo de impressão nativo.

### Configurações disponíveis

- **Imagem:** upload por drag-and-drop ou clique, thumbnail de preview
- **Tamanho da imagem:** largura e altura em mm, com opção de manter proporção (pela largura, pela altura, ou livre)
- **Alinhamento horizontal:** esquerda, centro, direita
- **Formato da folha:** A4, A3, Carta, ou dimensões personalizadas
- **Orientação:** retrato ou paisagem
- **Margens:** horizontal e vertical em mm
- **Espaçamento:** entre colunas e entre linhas em mm
- **Número de cópias:** quantas instâncias da imagem serão distribuídas na grade
- **Guias visuais:** sobreposição SVG mostrando margens (verde `#00810F`) e espaçamentos (laranja `#FF9926`), toggle on/off
- **Zoom:** controles de zoom no preview (%, botões +/−/fit)
- **Presets:** sistema completo de salvar/carregar/excluir configurações nomeadas, persistidos em `localStorage`

### PDF e Impressão

- **Salvar PDF:** dialog nativo de salvar arquivo, gera PDF via pdf-lib com as imagens posicionadas em coordenadas exatas em pontos (pt)
- **Imprimir:** abre o diálogo de impressão nativo do sistema via `webContents.print()` em uma janela oculta

### Sistema de Presets

- Dropdown customizado com `position: fixed` (evita clipping por `overflow:auto` do sidebar)
- Criação inline com campo de nome dentro do próprio dropdown
- Exclusão individual com botão por item
- Persistência via `localStorage` com chave `imagetiler_presets_v1`
- Estrutura de cada preset: `{ imgW, imgH, keepRatio, pageFormat, customW, customH, pageOrient, marginH, marginV, gapH, gapV, copies, align }`

### Bridge com Editor de Matriz

Duas funções expostas em `window`:

```js
window._tilerLoadImageFromDataUrl(dataUrl, imgEl)
// Carrega uma imagem recebida do Editor de Matriz

window._tilerApplyPreset(presetName, cfg)
// Aplica um preset recebido do Editor de Matriz (preenche todos os campos)
```

---

## Aba Editor de Matriz

**Arquivo:** `src/editor.js` (927 linhas)

### Funcionalidade

Permite importar imagens template (SVG ou PNG/JPEG), editar cores, adicionar textos sobrepostos, e enviar o resultado composto para o Tiler.

### Galeria de Matrizes

- Lista todas as matrizes salvas na pasta `matrizes/`
- Cada card mostra thumbnail, nome, badge SVG/raster, e preset vinculado
- Campo de busca por nome (filtro em tempo real)
- Scroll automático quando a lista excede a altura disponível
- Botões Editar e Excluir por card
- Confirmação antes de excluir

### Upload de Nova Matriz

O fluxo de upload contorna as limitações do Electron 42 com `contextIsolation`:

1. Botão "Nova Matriz" aciona `<input type="file">` oculto (aceita `image/*, .svg`)
2. O `preload.js` registra um listener `change` no input dentro do contexto isolado onde `webUtils` está disponível
3. `webUtils.getPathForFile(file)` captura o caminho real do arquivo em disco
4. O caminho é guardado num `Map` interno do preload
5. O renderer chama `electronAPI.getMatrixFilePath()` para recuperar o caminho
6. Modal pede o nome da matriz
7. `save-matrix` IPC copia o arquivo para `matrizes/<id>.ext` e cria `<id>.json`

**Por que não passar base64 pelo IPC:** o Electron tem limite de tamanho para argumentos IPC. Imagens grandes causam falha silenciosa. A solução é passar apenas o caminho do arquivo.

### Editor SVG

Para arquivos `.svg`:

- O SVG é inserido no DOM como elemento `<svg>` inline (não como `<img>`)
- Ao primeiro carregamento, paths compostos são divididos em subpaths individuais via `splitCompoundPaths()` — SVGs do ChatGPT/DALL-E usam um único `<path>` com múltiplos subpaths `Z M`, o que impediria selecionar formas individualmente
- Cada elemento `<path>`, `<rect>`, `<circle>` etc. recebe um listener de clique
- Ao clicar: painel flutuante aparece mostrando a cor atual, color picker, e dois botões:
  - **Aplicar** — troca a cor só do elemento clicado
  - **Aplicar a todas iguais** — troca todos os elementos com a mesma cor original (cor registrada no momento do clique, não no momento de confirmar)
- Edições são serializadas via `XMLSerializer` e salvas em `meta.svgContent` no JSON da matriz
- Ao reabrir: se existe `svgContent` salvo, usa esse; caso contrário usa o arquivo original e re-aplica o split

### Editor Raster (PNG/JPEG)

Para arquivos raster:

- Imagem renderizada em `<canvas>` escalado para caber na área
- Ferramenta de troca de cor: flood-fill por distância euclidiana RGB com tolerância ajustável (slider 1-120)
- Clique amostra a cor no pixel clicado e substitui todos os pixels dentro da tolerância
- Cada troca é registrada como layer `{ type: 'color', fromColor, toColor, tolerance }` no JSON
- Ao reabrir: trocas são reaplicadas sequencialmente a partir da imagem original

### Camadas de Texto

Funciona em ambos os formatos (SVG e raster):

- Div overlay posicionada com `position: absolute` sobre o canvas/SVG
- Cada texto é um elemento `div.text-layer-el` com coordenadas `x/y` relativas ao canto superior esquerdo da imagem
- **Arrastar:** `mousedown` captura as coordenadas iniciais, `mousemove` atualiza `style.left/top` diretamente sem recriar DOM (fluido)
- **Edição inline:** duplo clique ativa `contentEditable`, Enter ou Escape confirma
- **Propriedades:** barra inferior com campos de texto, fonte, tamanho, cor, negrito
- **Fontes:** tenta carregar fontes do sistema via `window.queryLocalFonts()` (API do Chromium); se negado, usa lista estática
- **Posicionamento ao trocar de aba:** `requestAnimationFrame` duplo aguarda o layout estabilizar antes de `rebuildTextDOM()`, evitando o "pulo" que ocorria quando `getBoundingClientRect()` retornava zero com o painel `display:none`
- **Redimensionar janela:** `ResizeObserver` no container reconstrói as posições dos textos com debounce de 60ms

### Undo/Redo

Pilha unificada (até 30 snapshots) que cobre cor e texto juntos:

- **SVG:** snapshot do `outerHTML` completo do elemento `<svg>`
- **Raster:** snapshot do `ImageData` + cópia dos arrays de colorLayers e textLayers
- Atalhos: `Ctrl+Z` (desfazer), `Ctrl+Y` / `Ctrl+Shift+Z` (refazer)
- Botões visuais que ficam opacos quando não há nada para desfazer/refazer

### Ferramentas

Três modos mutuamente exclusivos:

- **Mover** — nenhuma ação ao clicar, só arrastar textos existentes
- **Trocar Cor** — clique em elemento SVG ou pixel raster para substituir cor
- **Adicionar Texto** — clique cria nova camada de texto na posição clicada

### Preset Vinculado à Matriz

- Dropdown no toolbar do editor lista todos os presets do Tiler
- Ao selecionar, salva `presetName` no JSON da matriz via `update-matrix-meta` IPC
- Ao clicar "Usar no Tiler", o preset vinculado é aplicado automaticamente

### Exportar para Tiler

Abordagem pixel-perfect para garantir que o resultado no Tiler é idêntico ao que o usuário vê no editor:

1. Cria canvas com as mesmas dimensões que o elemento exibido (`offsetWidth/offsetHeight`)
2. Para SVG: serializa o SVG DOM atual (com edições de cor) como Blob URL, usa `drawImage` para renderizar no canvas
3. Para raster: copia o `ImageData` atual para o canvas
4. Desenha as camadas de texto com as coordenadas de exibição (sem escala)
5. Exporta como PNG e chama `window._tilerLoadImageFromDataUrl`

---

## IPC Handlers (main.js)

| Canal | Direção | Descrição |
|-------|---------|-----------|
| `save-pdf` | renderer→main | Salva PDF em disco via dialog |
| `print-pdf` | renderer→main | Abre dialog de impressão nativo |
| `list-matrices` | renderer→main | Lista todas as matrizes da pasta `matrizes/` |
| `save-matrix` | renderer→main | Copia arquivo para `matrizes/`, cria JSON |
| `update-matrix-layers` | renderer→main | Atualiza layers (cor/texto) no JSON |
| `save-svg-content` | renderer→main | Salva SVG editado no campo `svgContent` do JSON |
| `update-matrix-meta` | renderer→main | Atualiza `presetName` no JSON |
| `delete-matrix` | renderer→main | Remove arquivo e JSON da pasta |
| `read-matrix-image` | renderer→main | Lê arquivo da matriz (SVG como texto, raster como base64) |

---

## Estrutura do JSON de Matriz

```json
{
  "name": "Cassete Azul",
  "format": "svg",
  "layers": [
    { "type": "color", "fromColor": "#023c90", "toColor": "#ff0000", "tolerance": 40 },
    { "type": "text", "id": "abc123", "text": "Juvanil", "font": "Arial",
      "size": 32, "color": "#ffffff", "bold": true, "x": 120, "y": 80 }
  ],
  "svgContent": "<svg ...>...</svg>",
  "presetName": "Cassete A4",
  "createdAt": 1749600000000
}
```

---

## Problemas Resolvidos e Padrões Importantes

### `contextIsolation: true` e `webUtils`

Com `contextIsolation`, o preload e o renderer têm contextos JS separados. `File` objects não podem cruzar o `contextBridge` (são clonados e perdem a identidade). A solução: o preload registra um listener no `input[type=file]` do DOM, onde o objeto `File` está acessível no contexto do preload, e `webUtils.getPathForFile(file)` funciona corretamente.

### `sandbox: false`

Necessário para que o preload possa usar `require('electron')` e acessar `webUtils`, `ipcRenderer`, `contextBridge`. Com `sandbox: true` (padrão no Electron 20+), o preload não tem acesso a módulos Node nem Electron.

### Compound Paths no SVG

SVGs gerados por ferramentas como ChatGPT/DALL-E empacotam múltiplas formas no mesmo atributo `d` de um único `<path>`. Exemplo: todos os azuis do cassete são um único elemento DOM. Para permitir seleção individual, `splitCompoundPaths()` divide cada path composto em elementos `<path>` separados na primeira abertura.

### Dropdown de Preset com `position: fixed`

O sidebar do Tiler tem `overflow-y: auto`, o que cria um contexto de clipping que aprisiona elementos `position: absolute`. O dropdown de presets usa `position: fixed` com coordenadas calculadas via `getBoundingClientRect()` para escapar desse contexto.

### GPU no WSL2/Linux

O Electron em WSL2 não consegue acessar a GPU e entra em "Copy Mode" sem nenhum renderer. Solução: `app.disableHardwareAcceleration()` + `--disable-gpu` antes de `app.whenReady()`.
