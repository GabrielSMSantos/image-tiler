# Image Tiler

Aplicativo desktop para Windows que prepara imagens para impressão em múltiplas
cópias numa mesma folha — ideal para etiquetas, cartões, adesivos e qualquer
material que precise ser repetido várias vezes numa folha A4, A3, Carta ou em
um tamanho personalizado.

O app tem duas abas principais:

### 🧩 Tiler

Recebe uma imagem e a distribui em grade numa folha de impressão:

- Define o tamanho da imagem (largura/altura em cm), com opção de manter a proporção
- Escolhe o formato da folha (A4, A3, Carta ou personalizado) e a orientação (retrato/paisagem)
- Configura margens, espaçamento entre cópias, alinhamento e número de cópias
- Mostra guias visuais de margem e espaçamento sobre o preview
- Exporta o resultado como PDF ou envia direto para a impressora (suporta múltiplas páginas)
- Sistema de presets para salvar e reaproveitar configurações

### 🎨 Editor de Matriz

Permite preparar "matrizes" (imagens modelo) antes de usá-las no Tiler:

- Importa imagens nos formatos SVG, PNG ou JPEG
- Troca cores (em elementos do SVG ou por seleção de pixel em imagens raster)
- Adiciona camadas de texto sobre a imagem (fonte, tamanho, cor, negrito) e as arrasta livremente
- Desfazer/Refazer das alterações
- Exporta o resultado final como imagem PNG/JPEG, ou envia direto para o Tiler

---

## Para usuários — instalar e usar

1. Acesse a página de [Releases](https://github.com/GabrielSMSantos/image-tiler/releases)
2. Baixe a versão mais recente:
   - **`Image Tiler Setup X.X.X.exe`** — instalador (recomendado)
   - **`Image Tiler X.X.X.exe`** — versão portátil (não precisa instalar)
3. Execute o arquivo baixado
   - Se o Windows SmartScreen exibir um aviso, clique em "Mais informações" → "Executar assim mesmo"
4. Abra o app e comece a usar

O próprio app verifica se há novas versões disponíveis.

---

## Para desenvolvedores — executar o projeto

### Pré-requisitos

- [Node.js](https://nodejs.org/) 18 ou superior (inclui o npm)
- Windows (o build é gerado para Windows x64)

### Passo a passo

1. Clone o repositório:

   ```bash
   git clone https://github.com/GabrielSMSantos/image-tiler.git
   cd image-tiler
   ```

2. Instale as dependências:

   ```bash
   npm install
   ```

3. Execute em modo de desenvolvimento:

   ```bash
   npm start
   ```

### Gerar o instalador (.exe)

```bash
npm run build
```

Gera o instalador (`Image Tiler Setup X.X.X.exe`) e a versão portátil
(`Image Tiler X.X.X.exe`) dentro da pasta `dist/`.

Para gerar apenas a versão portátil:

```bash
npm run build-portable
```

---

## Estrutura do projeto

```
image-tiler/
├── main.js          # processo principal do Electron (janelas, IPC, acesso a arquivos)
├── preload.js       # bridge segura entre o processo principal e a interface
├── package.json
├── assets/          # ícones do app
└── src/
    ├── index.html   # layout e estilos das duas abas
    ├── renderer.js  # lógica da aba Tiler
    └── editor.js    # lógica da aba Editor de Matriz
```

As matrizes criadas pelo usuário ficam salvas localmente na pasta de dados do
app (`%APPDATA%\Image Tiler\matrizes`) e não fazem parte do repositório.

---

## Tecnologias

- [Electron](https://www.electronjs.org/)
- [pdf-lib](https://pdf-lib.js.org/) para geração de PDF
- HTML, CSS e JavaScript puro, sem frameworks
