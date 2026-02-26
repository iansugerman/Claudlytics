const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("claude", {
  getUsage: () => ipcRenderer.invoke("get-usage"),
});
