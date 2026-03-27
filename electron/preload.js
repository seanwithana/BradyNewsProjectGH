const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // News Feed
  getNewsFeed: (filters) => ipcRenderer.invoke('get-news-feed', filters),
  searchNews: (query) => ipcRenderer.invoke('search-news', query),

  // Rulesets
  getRulesets: () => ipcRenderer.invoke('get-rulesets'),
  saveRuleset: (ruleset) => ipcRenderer.invoke('save-ruleset', ruleset),
  deleteRuleset: (id) => ipcRenderer.invoke('delete-ruleset', id),
  updateRuleset: (ruleset) => ipcRenderer.invoke('update-ruleset', ruleset),
  toggleRuleset: (id, enabled) => ipcRenderer.invoke('toggle-ruleset', { id, enabled }),

  // Audio
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),

  // Reprocess
  reprocessNews: (opts) => ipcRenderer.invoke('reprocess-news', opts),

  // Dialogs
  confirmDialog: (message) => ipcRenderer.invoke('confirm-dialog', message),
  alertDialog: (message) => ipcRenderer.invoke('alert-dialog', message),

  // Audio
  getAudioData: (filePath) => ipcRenderer.invoke('get-audio-data', filePath),

  // LLM
  getLLMQueue: (filters) => ipcRenderer.invoke('get-llm-queue', filters),
  getLLMResult: (newsItemId) => ipcRenderer.invoke('get-llm-result', newsItemId),
  getLLMStats: () => ipcRenderer.invoke('get-llm-stats'),

  // Discord status
  getDiscordStatus: () => ipcRenderer.invoke('get-discord-status'),

  // All News
  getAllNews: (filters) => ipcRenderer.invoke('get-all-news', filters),

  // API Testing
  getApiProviders: () => ipcRenderer.invoke('get-api-providers'),
  extractArticleContent: (urlsJson) => ipcRenderer.invoke('extract-article-content', urlsJson),
  getApiTestingItems: () => ipcRenderer.invoke('get-api-testing-items'),
  callApi: (opts) => ipcRenderer.invoke('call-api', opts),

  // Stats
  getStats: () => ipcRenderer.invoke('get-stats'),

  // Finviz enrichment
  enqueueFinviz: (items) => ipcRenderer.invoke('enqueue-finviz', items),

  // Events
  onNewsFeedUpdate: (callback) => {
    ipcRenderer.on('news-feed-update', (_, data) => callback(data));
  },
  onReprocessComplete: (callback) => {
    ipcRenderer.on('reprocess-complete', (_, data) => callback(data));
  },
  onLLMComplete: (callback) => {
    ipcRenderer.on('llm-complete', (_, data) => callback(data));
  },
  onNewItemIngested: (callback) => {
    ipcRenderer.on('new-item-ingested', (_, data) => callback(data));
  },
  onFinvizUpdate: (callback) => {
    ipcRenderer.on('finviz-update', (_, data) => callback(data));
  }
});
