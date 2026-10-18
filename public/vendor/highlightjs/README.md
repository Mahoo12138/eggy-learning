# highlight.js browser ESM assets

Vendored, unchanged files from `@highlightjs/cdn-assets@11.12.0`.

- Upstream: https://github.com/highlightjs/highlight.js
- Distribution: https://www.npmjs.com/package/@highlightjs/cdn-assets
- License: BSD-3-Clause, included as `LICENSE`.
- Exact source URLs, byte counts and SHA-256 digests: `manifest.json`.
- Included: ESM core and C, C++, Bash, JSON, JavaScript, SQL grammars.

The application imports the core and only the requested grammar from same-origin URLs. No bundler, npm install, CDN runtime request, global `window.hljs`, or language auto-detection is required.

For C, the core and grammar total 25,289 bytes uncompressed. Other grammars are fetched only when requested.
