// --- DOM refs ---
const domainLabel = document.getElementById('domainLabel');
const acceptHeaderInput = document.getElementById('acceptHeader');
const fetchBtn = document.getElementById('fetchBtn');
const statusEl = document.getElementById('status');
const toggleCookies = document.getElementById('toggleCookies');
const toggleLocalStorage = document.getElementById('toggleLocalStorage');
const toggleSessionStorage = document.getElementById('toggleSessionStorage');
const toggleJavaScript = document.getElementById('toggleJavaScript');

let currentDomain = null;
let currentTabId = null;

// --- Helpers ---

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function showStatus(type, message) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function hideStatus() {
  statusEl.className = 'status hidden';
}

function isRestrictedUrl(url) {
  return !url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:');
}

// --- Active tab tracking ---

async function updateActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  currentTabId = tab.id;
  const domain = getDomain(tab.url);
  currentDomain = domain;
  domainLabel.textContent = domain || '—';

  if (domain && !isRestrictedUrl(tab.url)) {
    await loadSettings(domain);
    enableControls(true);
  } else {
    resetToggles();
    enableControls(false);
  }
}

function enableControls(enabled) {
  toggleCookies.disabled = !enabled;
  toggleLocalStorage.disabled = !enabled;
  toggleSessionStorage.disabled = !enabled;
  toggleJavaScript.disabled = !enabled;
  fetchBtn.disabled = !enabled;
}

function resetToggles() {
  toggleCookies.checked = false;
  toggleLocalStorage.checked = false;
  toggleSessionStorage.checked = false;
  toggleJavaScript.checked = false;
}

// --- Settings ---

async function loadSettings(domain) {
  const response = await chrome.runtime.sendMessage({ type: 'get-site-settings', domain });
  const s = response || {};
  toggleCookies.checked = !!s.blockCookies;
  toggleLocalStorage.checked = !!s.blockLocalStorage;
  toggleSessionStorage.checked = !!s.blockSessionStorage;
  toggleJavaScript.checked = !!s.blockJavaScript;
}

async function saveSettings() {
  if (!currentDomain) return;
  const settings = {
    blockCookies: toggleCookies.checked,
    blockLocalStorage: toggleLocalStorage.checked,
    blockSessionStorage: toggleSessionStorage.checked,
    blockJavaScript: toggleJavaScript.checked,
  };
  await chrome.runtime.sendMessage({ type: 'save-site-settings', domain: currentDomain, tabId: currentTabId, settings });

  // Reload tab when JS or storage blocking changes (needs fresh page load)
  if (currentTabId) {
    chrome.tabs.reload(currentTabId);
  }
}

// --- Fetch as LLM ---

function buildRenderedHtml(markdownHtml, originalUrl) {
  let origin;
  try {
    origin = new URL(originalUrl).origin;
  } catch {
    origin = '';
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <base href="${origin}/">
  <title>LLM View</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.7;
      color: #1a1a1a;
      background: #fff;
      padding: 40px 20px;
      max-width: 800px;
      margin: 0 auto;
    }
    h1, h2, h3, h4, h5, h6 { margin: 1.2em 0 0.4em; font-weight: 600; line-height: 1.3; }
    h1 { font-size: 2em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.2em; }
    h3 { font-size: 1.25em; }
    p { margin: 0.8em 0; }
    a { color: #0969da; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      background: #f0f0f0;
      padding: 0.15em 0.4em;
      border-radius: 4px;
      font-size: 0.9em;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    }
    pre {
      background: #f6f8fa;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1em 0;
    }
    pre code { background: none; padding: 0; font-size: 0.85em; }
    blockquote {
      border-left: 4px solid #ddd;
      padding: 0.5em 1em;
      margin: 1em 0;
      color: #555;
    }
    ul, ol { margin: 0.8em 0; padding-left: 2em; }
    li { margin: 0.3em 0; }
    table { border-collapse: collapse; margin: 1em 0; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f6f8fa; font-weight: 600; }
    img { max-width: 100%; height: auto; }
    hr { border: none; border-top: 1px solid #eee; margin: 2em 0; }
    .llm-view-banner {
      background: #e8f0fe;
      color: #1a56db;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 12px;
      margin-bottom: 24px;
      font-family: sans-serif;
    }
  </style>
</head>
<body>
  <div class="llm-view-banner">LLM View of ${escapeHtml(originalUrl)}</div>
  ${markdownHtml}
</body>
</html>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function handleFetch() {
  if (!currentTabId || !currentDomain) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || isRestrictedUrl(tab.url)) {
    showStatus('error', 'Cannot fetch restricted URLs (chrome://, about:, etc.)');
    return;
  }

  const url = tab.url;
  const acceptHeader = acceptHeaderInput.value.trim();
  if (!acceptHeader) {
    showStatus('error', 'Accept header cannot be empty.');
    return;
  }

  fetchBtn.disabled = true;
  showStatus('loading', 'Fetching...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'fetch-as-llm',
      url,
      acceptHeader,
    });

    if (response.error) {
      showStatus('error', response.error);
      fetchBtn.disabled = false;
      return;
    }

    const contentType = response.contentType || '';
    const body = response.body || '';

    // Parse as markdown if content looks like markdown, otherwise show raw
    const isMarkdown = contentType.includes('markdown') || contentType.includes('text/plain') || !contentType.includes('text/html');
    let html;
    if (isMarkdown) {
      html = buildRenderedHtml(marked.parse(body), url);
    } else {
      // For HTML responses, render the markdown-parsed version anyway
      // (the user asked to see it "as an LLM" — show the raw text rendered)
      html = buildRenderedHtml(marked.parse(body), url);
    }

    await chrome.runtime.sendMessage({
      type: 'replace-tab-content',
      tabId: currentTabId,
      html,
    });

    showStatus('success', `Fetched (${contentType || 'unknown type'})`);
  } catch (err) {
    showStatus('error', `Error: ${err.message}`);
  }

  fetchBtn.disabled = false;
}

// --- Event listeners ---

fetchBtn.addEventListener('click', handleFetch);

toggleCookies.addEventListener('change', saveSettings);
toggleLocalStorage.addEventListener('change', saveSettings);
toggleSessionStorage.addEventListener('change', saveSettings);
toggleJavaScript.addEventListener('change', saveSettings);

chrome.tabs.onActivated.addListener(updateActiveTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateActiveTab();
  }
});

// Init
updateActiveTab();
