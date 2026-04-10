# Claude Code Rules

- No build step. Vanilla JS/CSS/HTML only. No npm, no bundler, no TypeScript.
- Vendor libraries as minified files in `lib/`. No CDN references at runtime.
- All fetch headers MUST go through `declarativeNetRequest` temporary rules, NOT `fetch()` headers param. `User-Agent` and `Cookie` are forbidden headers in the Fetch API.
- Use `credentials: 'include'` for fetches that may encounter Set-Cookie redirects (e.g. Vercel protection bypass).
- Per-site settings keyed by domain in `chrome.storage.local`. Key format: `site_{domain}`, `headers_{domain}`.
- Side panel communicates with service worker via `chrome.runtime.sendMessage`. All async handlers return via `sendResponse`.
- When adding new `declarativeNetRequest` rules, always remove the rule ID first to avoid duplicates.
- Dark mode support via `@media (prefers-color-scheme: dark)` in CSS.
- Do not add comments, docstrings, or type annotations to code you didn't change.
- Test by loading unpacked at `chrome://extensions`. There are no automated tests.
