import { sendTelemetry } from './telemetry';

window.telemetrySentSites = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (!port.sender.tab) {
    return;
  }
  const tabId = port.sender.tab.id;
  port.onMessage.addListener((message) => {
    if (message.cmp) {
      chrome.pageAction.show(tabId);
      chrome.tabs.get(tabId, (tab) => {
        const site = new URL(tab.url).host;
        sendTelemetry({
          type: 'iab',
          site,
        }, 'metrics.consentric.pageAction');
      });
    }
  });
});