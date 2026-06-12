const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Sem require('fs') ou qualquer módulo Node — apenas APIs do Electron
// Com contextIsolation=true, Node modules não estão disponíveis no preload
// a menos que sandbox:false seja configurado (não queremos isso por segurança).

const filePathCache = new Map();

function registerInputListener() {
  var input = document.getElementById('matrixFileInput');
  if (!input) {
    setTimeout(registerInputListener, 200);
    return;
  }
  input.addEventListener('change', function() {
    var file = input.files && input.files[0];
    if (!file) { filePathCache.set('matrix', ''); return; }
    var p = '';
    try { p = webUtils.getPathForFile(file) || ''; } catch(e) {}
    filePathCache.set('matrix', p);
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', registerInputListener);
} else {
  registerInputListener();
}

contextBridge.exposeInMainWorld('electronAPI', {
  savePDF:            (b) => ipcRenderer.invoke('save-pdf', b),
  printHTML:          (html, pageSize) => ipcRenderer.invoke('print-html', { html, pageSize }),
  getMatrixFilePath:  ()  => filePathCache.get('matrix') || null,
  listMatrices:       ()  => ipcRenderer.invoke('list-matrices'),
  saveMatrix:         (d) => ipcRenderer.invoke('save-matrix', d),
  updateMatrixLayers: (d) => ipcRenderer.invoke('update-matrix-layers', d),
  saveSvgContent:     (d) => ipcRenderer.invoke('save-svg-content', d),
  updateMatrixMeta:   (d) => ipcRenderer.invoke('update-matrix-meta', d),
  deleteMatrix:       (d) => ipcRenderer.invoke('delete-matrix', d),
  readMatrixImage:    (d) => ipcRenderer.invoke('read-matrix-image', d),
  checkForUpdates:    ()  => ipcRenderer.invoke('check-for-updates'),
  openExternal:       (url) => ipcRenderer.invoke('open-external', url),
  exportImageDialog:  (defaultName) => ipcRenderer.invoke('export-image-dialog', defaultName),
  writeImageFile:     (d) => ipcRenderer.invoke('write-image-file', d),
});
