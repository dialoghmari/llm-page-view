// --- Open side panel on action click ---
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// --- Deterministic rule ID from domain ---
function domainHash(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = ((hash << 5) - hash + domain.charCodeAt(i)) | 0;
  }
  // Ensure positive, in safe range (1 to 2^30)
  return (Math.abs(hash) % (1 << 30)) + 1;
}

function cookieRuleId(domain) {
  return domainHash(domain) * 2;
}

function jsRuleId(domain) {
  return domainHash(domain) * 2 + 1;
}

// --- Settings helpers ---

function settingsKey(domain) {
  return `site_${domain}`;
}

async function getSiteSettings(domain) {
  const result = await chrome.storage.local.get(settingsKey(domain));
  return result[settingsKey(domain)] || {};
}

async function saveSiteSettings(domain, settings) {
  await chrome.storage.local.set({ [settingsKey(domain)]: settings });
}

// --- Cookie blocking via declarativeNetRequest ---

async function applyCookieBlocking(domain, enabled) {
  const ruleId = cookieRuleId(domain);

  // Always remove first to avoid duplicates
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ruleId],
  });

  if (enabled) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [{
        id: ruleId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Cookie', operation: 'remove' },
          ],
          responseHeaders: [
            { header: 'Set-Cookie', operation: 'remove' },
          ],
        },
        condition: {
          requestDomains: [domain],
          resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'stylesheet', 'script', 'image', 'font', 'other'],
        },
      }],
    });
  }
}

// --- JS blocking via declarativeNetRequest ---

async function applyJsBlocking(domain, enabled) {
  const ruleId = jsRuleId(domain);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ruleId],
  });

  if (enabled) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [{
        id: ruleId,
        priority: 1,
        action: { type: 'block' },
        condition: {
          requestDomains: [domain],
          resourceTypes: ['script'],
        },
      }],
    });
  }
}

// --- Storage blocking via content script injection ---

async function applyStorageBlocking(tabId, blockLocal, blockSession) {
  if (!blockLocal && !blockSession) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      injectImmediately: true,
      func: (bl, bs) => {
        if (bl) {
          try {
            Object.defineProperty(window, 'localStorage', {
              get() { throw new DOMException('localStorage is blocked by See it as an LLM', 'SecurityError'); },
              configurable: true,
            });
          } catch {}
        }
        if (bs) {
          try {
            Object.defineProperty(window, 'sessionStorage', {
              get() { throw new DOMException('sessionStorage is blocked by See it as an LLM', 'SecurityError'); },
              configurable: true,
            });
          } catch {}
        }
      },
      args: [blockLocal, blockSession],
    });
  } catch {
    // Tab may not be injectable (e.g. chrome:// pages)
  }
}

// --- Apply all blocking rules for a domain ---

async function applyAllRules(domain, settings, tabId) {
  await applyCookieBlocking(domain, settings.blockCookies);
  await applyJsBlocking(domain, settings.blockJavaScript);
  if (tabId) {
    await applyStorageBlocking(tabId, settings.blockLocalStorage, settings.blockSessionStorage);
  }
}

// --- Inject storage blocking on navigation ---

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' || !tab.url) return;

  let domain;
  try {
    domain = new URL(tab.url).hostname;
  } catch {
    return;
  }

  const settings = await getSiteSettings(domain);
  if (settings.blockLocalStorage || settings.blockSessionStorage) {
    await applyStorageBlocking(tabId, settings.blockLocalStorage, settings.blockSessionStorage);
  }
});

// --- Message handler ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // keep channel open for async response
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'fetch-as-llm':
      return await handleFetchAsLlm(msg);

    case 'replace-tab-content':
      return await handleReplaceTabContent(msg);

    case 'get-site-settings':
      return await getSiteSettings(msg.domain);

    case 'save-site-settings':
      await saveSiteSettings(msg.domain, msg.settings);
      await applyAllRules(msg.domain, msg.settings, msg.tabId);
      return { ok: true };

    case 'get-prism-source':
      return await handleGetPrismSource();

    default:
      return { error: 'Unknown message type' };
  }
}

async function handleGetPrismSource() {
  try {
    const files = [
      'lib/prism.min.js',
      'lib/prism-markup.min.js',
      'lib/prism-css.min.js',
      'lib/prism-javascript.min.js',
      'lib/prism-typescript.min.js',
      'lib/prism-python.min.js',
      'lib/prism-bash.min.js',
      'lib/prism-json.min.js',
      'lib/prism-yaml.min.js',
      'lib/prism-jsx.min.js',
      'lib/prism-tsx.min.js',
    ];
    const sources = await Promise.all(
      files.map(f => fetch(chrome.runtime.getURL(f)).then(r => r.text()).catch(() => ''))
    );
    return { source: sources.join('\n') };
  } catch {
    return { source: '' };
  }
}

async function handleFetchAsLlm({ url, acceptHeader, userAgent }) {
  try {
    const headers = { 'Accept': acceptHeader };
    if (userAgent) {
      headers['User-Agent'] = userAgent;
    }
    const response = await fetch(url, {
      headers,
      credentials: 'omit',
    });
    const body = await response.text();
    const contentType = response.headers.get('Content-Type') || '';
    return { body, contentType, status: response.status };
  } catch (err) {
    return { error: `Fetch failed: ${err.message}` };
  }
}

async function handleReplaceTabContent({ tabId, html }) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (htmlContent) => {
        document.open();
        document.write(htmlContent);
        document.close();
      },
      args: [html],
    });
    return { ok: true };
  } catch (err) {
    return { error: `Could not replace tab content: ${err.message}` };
  }
}
