// --- DOM refs ---
const domainLabel = document.getElementById('domainLabel');
const acceptHeaderInput = document.getElementById('acceptHeader');
const userAgentSelect = document.getElementById('userAgentSelect');
const userAgentCustom = document.getElementById('userAgentCustom');
const fetchBtn = document.getElementById('fetchBtn');
const statusEl = document.getElementById('status');
const toggleRenderMarkdown = document.getElementById('toggleRenderMarkdown');
const toggleFrontmatter = document.getElementById('toggleFrontmatter');
const toggleCookies = document.getElementById('toggleCookies');
const toggleLocalStorage = document.getElementById('toggleLocalStorage');
const toggleSessionStorage = document.getElementById('toggleSessionStorage');
const toggleJavaScript = document.getElementById('toggleJavaScript');
const toggleInjectHeaders = document.getElementById('toggleInjectHeaders');
const customHeadersList = document.getElementById('customHeadersList');
const addHeaderBtn = document.getElementById('addHeaderBtn');

let currentDomain = null;
let currentTabId = null;

// --- Prism.js CSS (inlined in rendered pages) ---
const PRISM_CSS = `code[class*=language-],pre[class*=language-]{color:#ccc;background:0 0;font-family:Consolas,Monaco,'Andale Mono','Ubuntu Mono',monospace;font-size:1em;text-align:left;white-space:pre;word-spacing:normal;word-break:normal;word-wrap:normal;line-height:1.5;-moz-tab-size:4;-o-tab-size:4;tab-size:4;-webkit-hyphens:none;-moz-hyphens:none;-ms-hyphens:none;hyphens:none}pre[class*=language-]{padding:1em;margin:.5em 0;overflow:auto}:not(pre)>code[class*=language-],pre[class*=language-]{background:#2d2d2d}:not(pre)>code[class*=language-]{padding:.1em;border-radius:.3em;white-space:normal}.token.block-comment,.token.cdata,.token.comment,.token.doctype,.token.prolog{color:#999}.token.punctuation{color:#ccc}.token.attr-name,.token.deleted,.token.namespace,.token.tag{color:#e2777a}.token.function-name{color:#6196cc}.token.boolean,.token.function,.token.number{color:#f08d49}.token.class-name,.token.constant,.token.property,.token.symbol{color:#f8c555}.token.atrule,.token.builtin,.token.important,.token.keyword,.token.selector{color:#cc99cd}.token.attr-value,.token.char,.token.regex,.token.string,.token.variable{color:#7ec699}.token.entity,.token.operator,.token.url{color:#67cdcc}.token.bold,.token.important{font-weight:700}.token.italic{font-style:italic}.token.entity{cursor:help}.token.inserted{color:green}`;

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

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getUserAgent() {
  if (userAgentSelect.value === 'custom') {
    return userAgentCustom.value.trim() || 'ChatGPT-User';
  }
  return userAgentSelect.value;
}

// --- Frontmatter parsing ---

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: null, body: text };

  const raw = match[1];
  const body = text.slice(match[0].length);
  const meta = {};

  for (const line of raw.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) meta[key] = value;
  }

  return { frontmatter: meta, frontmatterRaw: raw, body };
}

function buildFrontmatterCard(meta) {
  let card = '<div class="fm-card">';

  if (meta.image) {
    card += `<div class="fm-image"><img src="${escapeHtml(meta.image)}" alt=""></div>`;
  }
  if (meta.title) {
    card += `<div class="fm-title">${escapeHtml(meta.title)}</div>`;
  }
  if (meta.description) {
    card += `<div class="fm-description">${escapeHtml(meta.description)}</div>`;
  }

  // Show remaining fields
  const skip = new Set(['title', 'description', 'image']);
  const rest = Object.entries(meta).filter(([k]) => !skip.has(k));
  if (rest.length > 0) {
    card += '<div class="fm-fields">';
    for (const [key, value] of rest) {
      card += `<div class="fm-field"><span class="fm-key">${escapeHtml(key)}</span><span class="fm-value">${escapeHtml(value)}</span></div>`;
    }
    card += '</div>';
  }

  card += '</div>';
  return card;
}

// --- Rendered HTML builder ---

function buildRenderedHtml(content, originalUrl, frontmatterHtml) {
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
    ${PRISM_CSS}
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
      background: #2d2d2d;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1em 0;
    }
    pre code { background: none; padding: 0; font-size: 0.85em; color: #ccc; }
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
    /* Frontmatter card */
    .fm-card {
      background: #f8f9fa;
      border: 1px solid #e0e0e0;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 28px;
      overflow: hidden;
    }
    .fm-image { margin-bottom: 14px; }
    .fm-image img { width: 100%; max-height: 200px; object-fit: cover; border-radius: 6px; }
    .fm-title { font-size: 1.4em; font-weight: 700; color: #111; margin-bottom: 8px; }
    .fm-description { font-size: 0.95em; color: #444; line-height: 1.5; margin-bottom: 12px; }
    .fm-fields { border-top: 1px solid #e0e0e0; padding-top: 10px; }
    .fm-field { display: flex; gap: 8px; padding: 4px 0; font-size: 0.85em; }
    .fm-key { color: #666; font-weight: 600; min-width: 80px; flex-shrink: 0; }
    .fm-key::after { content: ":"; }
    .fm-value { color: #333; word-break: break-word; }
  </style>
</head>
<body>
  <div class="llm-view-banner">LLM View of ${escapeHtml(originalUrl)}</div>
  ${frontmatterHtml || ''}
  ${content}
  <script>
    // Prism.js inline for code highlighting
    ${PRISM_JS_PLACEHOLDER}
    if (typeof Prism !== 'undefined') Prism.highlightAll();
  </script>
</body>
</html>`;
}

function buildRawHtml(rawText, originalUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>LLM View (raw)</title>
</head>
<body>${escapeHtml(rawText)}</body>
</html>`;
}

// Placeholder — will be replaced with actual Prism JS at fetch time
let PRISM_JS_PLACEHOLDER = '';

// Load Prism.js source to inline in rendered pages
async function loadPrismSource() {
  const response = await chrome.runtime.sendMessage({ type: 'get-prism-source' });
  if (response && response.source) {
    PRISM_JS_PLACEHOLDER = response.source;
  }
}

// --- Custom headers ---

function createHeaderRow(key = '', value = '') {
  const row = document.createElement('div');
  row.className = 'header-row';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'text-input header-key';
  keyInput.placeholder = 'Header name';
  keyInput.value = key;
  keyInput.spellcheck = false;

  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.className = 'text-input header-value';
  valueInput.placeholder = 'Value';
  valueInput.value = value;
  valueInput.spellcheck = false;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-remove-header';
  removeBtn.textContent = '\u00d7';
  removeBtn.title = 'Remove header';
  removeBtn.addEventListener('click', () => {
    row.remove();
    saveCustomHeaders();
  });

  keyInput.addEventListener('input', saveCustomHeaders);
  valueInput.addEventListener('input', saveCustomHeaders);

  row.appendChild(keyInput);
  row.appendChild(valueInput);
  row.appendChild(removeBtn);
  return row;
}

function getCustomHeaders() {
  const rows = customHeadersList.querySelectorAll('.header-row');
  const headers = [];
  for (const row of rows) {
    const key = row.querySelector('.header-key').value.trim();
    const value = row.querySelector('.header-value').value.trim();
    if (key) headers.push({ key, value });
  }
  return headers;
}

function renderCustomHeaders(headers) {
  customHeadersList.innerHTML = '';
  if (headers && headers.length > 0) {
    for (const { key, value } of headers) {
      customHeadersList.appendChild(createHeaderRow(key, value));
    }
  }
}

let _saveHeadersTimer = null;
function saveCustomHeaders() {
  clearTimeout(_saveHeadersTimer);
  _saveHeadersTimer = setTimeout(_doSaveCustomHeaders, 300);
}

async function _doSaveCustomHeaders() {
  if (!currentDomain) return;
  const headers = getCustomHeaders();
  const injectEnabled = toggleInjectHeaders.checked;
  await chrome.runtime.sendMessage({
    type: 'save-custom-headers',
    domain: currentDomain,
    headers,
    injectEnabled,
  });
}

async function loadCustomHeaders(domain) {
  const response = await chrome.runtime.sendMessage({ type: 'get-custom-headers', domain });
  const data = response || {};
  renderCustomHeaders(data.headers || []);
  toggleInjectHeaders.checked = !!data.injectEnabled;
}

addHeaderBtn.addEventListener('click', () => {
  customHeadersList.appendChild(createHeaderRow());
});

toggleInjectHeaders.addEventListener('change', saveCustomHeaders);

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
    await loadCustomHeaders(domain);
    enableControls(true);
  } else {
    resetToggles();
    renderCustomHeaders([]);
    toggleInjectHeaders.checked = false;
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

  // Reload tab when blocking changes (needs fresh page load)
  if (currentTabId) {
    chrome.tabs.reload(currentTabId);
  }
}

// --- Fetch as LLM ---

async function handleFetch(overrideUrl) {
  if (!currentTabId || !currentDomain) return;

  let url;
  if (overrideUrl) {
    url = overrideUrl;
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || isRestrictedUrl(tab.url)) {
      showStatus('error', 'Cannot fetch restricted URLs (chrome://, about:, etc.)');
      return;
    }
    url = tab.url;
  }

  const acceptHeader = acceptHeaderInput.value.trim();
  if (!acceptHeader) {
    showStatus('error', 'Accept header cannot be empty.');
    return;
  }

  const userAgent = getUserAgent();

  fetchBtn.disabled = true;
  showStatus('loading', 'Fetching...');

  try {
    const customHeaders = getCustomHeaders();
    const response = await chrome.runtime.sendMessage({
      type: 'fetch-as-llm',
      url,
      acceptHeader,
      userAgent,
      customHeaders,
    });

    if (response.error) {
      showStatus('error', response.error);
      fetchBtn.disabled = false;
      return;
    }

    const contentType = response.contentType || '';
    const body = response.body || '';
    const renderMarkdown = toggleRenderMarkdown.checked;

    let html;
    if (!renderMarkdown) {
      // Raw mode — no styling
      html = buildRawHtml(body, url);
    } else {
      // Parse frontmatter
      const { frontmatter, body: mdBody } = parseFrontmatter(body);

      let frontmatterHtml = '';
      if (frontmatter && toggleFrontmatter.checked) {
        frontmatterHtml = buildFrontmatterCard(frontmatter);
      }

      // Configure marked to add language classes for Prism
      const renderedMarkdown = marked.parse(mdBody);
      html = buildRenderedHtml(renderedMarkdown, url, frontmatterHtml);
    }

    await chrome.runtime.sendMessage({
      type: 'replace-tab-content',
      tabId: currentTabId,
      html,
    });

    const redirectInfo = response.redirected ? ' (redirected)' : '';
    showStatus('success', `Fetched (${contentType || 'unknown type'})${redirectInfo}`);
  } catch (err) {
    showStatus('error', `Error: ${err.message}`);
  }

  fetchBtn.disabled = false;
}

// --- User-Agent dropdown ---

userAgentSelect.addEventListener('change', () => {
  if (userAgentSelect.value === 'custom') {
    userAgentCustom.classList.remove('hidden');
    userAgentCustom.focus();
  } else {
    userAgentCustom.classList.add('hidden');
  }
});

// --- Event listeners ---

fetchBtn.addEventListener('click', () => handleFetch());

// Listen for link navigation from rendered pages
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'do-fetch-url' && msg.url) {
    handleFetch(msg.url);
  }
});

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
loadPrismSource();
updateActiveTab();
