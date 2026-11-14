// Service worker. Deliberately thin: relays messages between the frames of a tab, handles the
// keyboard shortcut, shows the participant count and injects the content scripts on sites the user
// enabled by hand. The party itself lives in the tab, so it dies with the tab.

// Keep in sync with content_scripts[0].js in manifest.json.
const FILES = ['config.js', 'content/core.js', 'content/realtime.js', 'content/player.js', 'content/ui.js', 'content/main.js'];
const quiet = () => {};

chrome.runtime.onMessage.addListener((m, sender) => {
  if (!m || sender.id !== chrome.runtime.id || !sender.tab) return;
  const tabId = sender.tab.id;
  if (m.zp === 'relay') {
    const options = m.to === 'top' ? { frameId: 0 } : undefined;
    chrome.tabs.sendMessage(tabId, { zp: 'relayed', msg: m.msg }, options).catch(quiet);
  } else if (m.zp === 'badge') {
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#c8f542' }).catch(quiet);
    chrome.action.setBadgeText({ tabId, text: String(m.text || '').slice(0, 3) }).catch(quiet);
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-sidebar' && tab && tab.id != null) {
    chrome.tabs.sendMessage(tab.id, { zp: 'toggle' }, { frameId: 0 }).catch(quiet);
  }
});

// "Enable on this site": once the user grants an origin, keep our scripts registered for it (so
// invite links auto-join after a reload) and inject into the tabs already open.
chrome.permissions.onAdded.addListener(async ({ origins = [] }) => {
  for (const origin of origins) {
    try {
      await chrome.scripting.registerContentScripts([
        { id: 'zp:' + origin, matches: [origin], js: FILES, allFrames: true, runAt: 'document_start' },
      ]);
    } catch {
      // Already registered.
    }
  }
  if (!origins.length) return;
  const tabs = await chrome.tabs.query({ url: origins }).catch(() => []);
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: FILES }).catch(quiet);
  }
});

chrome.permissions.onRemoved.addListener(({ origins = [] }) => {
  if (origins.length) chrome.scripting.unregisterContentScripts({ ids: origins.map((o) => 'zp:' + o) }).catch(quiet);
});
