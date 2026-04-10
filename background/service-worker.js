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

// Rule ID slots per domain: base*4, base*4+1, base*4+2, base*4+3
function cookieRuleId(domain) {
  return domainHash(domain) * 4;
}

function jsRuleId(domain) {
  return domainHash(domain) * 4 + 1;
}

function customHeadersRuleId(domain) {
  return domainHash(domain) * 4 + 2;
}

// Reserved rule ID for temporary fetch-time header injection (outside domain hash range)
const FETCH_TEMP_RULE_ID = (1 << 30) + 100;

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

// --- Custom headers storage and injection ---

function customHeadersKey(domain) {
  return `headers_${domain}`;
}

async function getCustomHeaders(domain) {
  const result = await chrome.storage.local.get(customHeadersKey(domain));
  return result[customHeadersKey(domain)] || {};
}

async function saveCustomHeaders(domain, headers, injectEnabled) {
  await chrome.storage.local.set({
    [customHeadersKey(domain)]: { headers, injectEnabled },
  });
}

async function applyCustomHeaderInjection(domain, headers, injectEnabled) {
  const ruleId = customHeadersRuleId(domain);

  // Always remove existing rule first
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ruleId],
  });

  // Only add if enabled and there are headers with non-empty keys
  const validHeaders = (headers || []).filter(h => h.key);
  if (!injectEnabled || validHeaders.length === 0) return;

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [{
      id: ruleId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: validHeaders.map(h => ({
          header: h.key,
          operation: 'set',
          value: h.value,
        })),
      },
      condition: {
        requestDomains: [domain],
        resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'stylesheet', 'script', 'image', 'font', 'other'],
      },
    }],
  });
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

    case 'get-custom-headers':
      return await getCustomHeaders(msg.domain);

    case 'save-custom-headers':
      await saveCustomHeaders(msg.domain, msg.headers, msg.injectEnabled);
      await applyCustomHeaderInjection(msg.domain, msg.headers, msg.injectEnabled);
      return { ok: true };

    case 'navigate-llm':
      // Forward to side panel so it can re-fetch with current settings
      chrome.runtime.sendMessage({ type: 'do-fetch-url', url: msg.url }).catch(() => {});
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

async function handleFetchAsLlm({ url, acceptHeader, userAgent, customHeaders }) {
  let domain;
  try {
    domain = new URL(url).hostname;
  } catch (err) {
    return { error: `Invalid URL: ${err.message}` };
  }

  // Build the header list for declarativeNetRequest injection.
  // This is more reliable than fetch() headers because User-Agent
  // is a forbidden header in the Fetch API (silently dropped).
  const requestHeaders = [
    { header: 'Accept', operation: 'set', value: acceptHeader },
  ];

  if (userAgent) {
    requestHeaders.push({ header: 'User-Agent', operation: 'set', value: userAgent });
  }

  if (customHeaders && customHeaders.length > 0) {
    for (const { key, value } of customHeaders) {
      if (key) {
        requestHeaders.push({ header: key, operation: 'set', value: value || '' });
      }
    }
  }

  try {
    // Set temporary rule to inject headers on all requests to this domain.
    // This covers both the initial request AND any redirect-followed requests
    // (e.g. Vercel 307 bypass redirects). The browser handles redirects natively,
    // storing Set-Cookie and forwarding cookies on subsequent hops.
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [FETCH_TEMP_RULE_ID],
      addRules: [{
        id: FETCH_TEMP_RULE_ID,
        priority: 2,
        action: {
          type: 'modifyHeaders',
          requestHeaders,
        },
        condition: {
          requestDomains: [domain],
          resourceTypes: ['xmlhttprequest', 'other'],
        },
      }],
    });

    // credentials: 'include' so the browser stores Set-Cookie from redirects
    // and forwards them on subsequent hops (needed for Vercel bypass JWT).
    // redirect: 'follow' (default) lets the browser handle redirects natively.
    const response = await fetch(url, { credentials: 'include' });
    const body = await response.text();
    const contentType = response.headers.get('Content-Type') || '';
    const finalUrl = response.url;

    // Clean up temporary rule
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [FETCH_TEMP_RULE_ID],
    });

    return {
      body,
      contentType,
      status: response.status,
      finalUrl,
      redirected: response.redirected || undefined,
    };
  } catch (err) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [FETCH_TEMP_RULE_ID],
    }).catch(() => {});
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

    // Inject link click interceptor so navigation stays within the extension
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        document.addEventListener('click', (e) => {
          const anchor = e.target.closest('a[href]');
          if (!anchor) return;
          const href = anchor.href;
          if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;
          e.preventDefault();
          chrome.runtime.sendMessage({ type: 'navigate-llm', url: href });
        });
      },
    });

    return { ok: true };
  } catch (err) {
    return { error: `Could not replace tab content: ${err.message}` };
  }
}
