# LLM Page View

Chrome Extension (Manifest V3) to preview web pages as an LLM sees them.

## Structure

```
manifest.json                 # MV3 manifest, permissions, side panel config
background/service-worker.js  # Central coordinator: fetch, DNR rules, storage, messaging
sidepanel/
  sidepanel.html              # Side panel UI layout
  sidepanel.css               # Styles + dark mode
  sidepanel.js                # UI logic, markdown rendering, settings management
lib/
  marked.min.js               # Markdown parser (v15.0.7, vendored)
  prism.min.js                # Syntax highlighter (v1.29.0, vendored)
  prism-*.min.js              # Language packs: js, ts, py, bash, json, css, html, yaml, jsx, tsx
  prism-tomorrow.min.css      # Prism dark theme (inlined in rendered pages)
icons/                        # Extension icons 16/48/128px
```

## Features

- **Fetch as LLM** -- Re-fetch current page with custom `Accept` header (default: `text/markdown, text/html`), custom `User-Agent` (presets: ChatGPT, Claude, Google-Extended, Perplexity), and custom key/value headers. Response replaces tab content as rendered markdown.
- **Render toggle** -- Switch between rendered markdown (with Prism.js code highlighting) and raw unstyled text.
- **Frontmatter** -- Parse YAML `---` blocks, display as styled card (image, title, description, metadata). Toggleable.
- **Custom headers** -- Dynamic key/value rows, per-site persistence, injectable into ALL site requests via `declarativeNetRequest`. Master toggle. Used for Vercel `x-vercel-protection-bypass`.
- **Site controls** -- Per-site toggles: block cookies (strip Cookie/Set-Cookie via DNR), block JS (block script resources via DNR), block localStorage/sessionStorage (MAIN world script injection).
- **Redirects** -- `credentials: 'include'` + `redirect: 'follow'` so browser handles Set-Cookie forwarding natively (fixes Vercel 307 bypass loop).

## Architecture Notes

- **No build step** -- Vanilla HTML/CSS/JS, vendored libs, no bundler.
- **Headers via `declarativeNetRequest`** -- All fetch headers (Accept, User-Agent, custom) are injected via temporary DNR rules, not `fetch()` headers. This bypasses the Fetch API's forbidden header restriction (`User-Agent` is silently dropped by `fetch()`).
- **Per-site settings** -- Stored in `chrome.storage.local` keyed by `site_{domain}` and `headers_{domain}`.
- **Rule ID scheme** -- `domainHash(domain) * 4 + offset` (0=cookies, 1=JS, 2=custom headers). Temp fetch rule: `(1<<30)+100`.
- **Storage blocking** -- Injected via `chrome.scripting.executeScript({ world: 'MAIN', injectImmediately: true })` on `tabs.onUpdated` (status=loading).

## Permissions

`sidePanel`, `activeTab`, `scripting`, `storage`, `declarativeNetRequest`, `host_permissions: <all_urls>`

## Dev

Load unpacked at `chrome://extensions` (Developer Mode). Reload extension after code changes.
