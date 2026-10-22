# ZANZA STUDIO - FULL DEPLOYMENT GUIDE

## Overview
ZANZA STUDIO is a static, local-first web application. It has no server, backend, accounts, or network calls. Deploying it means uploading the built `dist/` directory to any static file host.

## Prerequisites
- Node.js 20+ (tested on 22.16.0)
- npm 10+
- A static file host (Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3+CloudFront, nginx, etc.)
- Modern browser (Chrome/Edge 111+, Firefox 128+, Safari 16.4+)

## Build Process
1. Install dependencies: `npm ci`
2. Run all gates: `npm run verify` (lint, typecheck, test, build - all must pass)
3. Build manually if needed: `npm run build` (outputs to `dist/`)

## Serving Requirements
CRITICAL: Do NOT open `dist/index.html` directly from filesystem (file://). IndexedDB will fail. Serve over HTTP/HTTPS. For local preview: `npm run preview`.

## Hosting Options

### Vercel (Recommended)
- Build command: `npm run build`
- Output directory: `dist`
- Repo linked: joan-kaburas-projects/zanza-studio (git: https://github.com/kafura0/kafuraStudio)
- Deploy: `vercel --prod`

### Netlify / Cloudflare Pages
- Build command: `npm run build`
- Publish/output directory: `dist`
- No SPA rewrites needed

### GitHub Pages (Subpath)
If hosting under subdirectory: `npm run build -- --base=/repo-name/`

## Caching
- `/index.html`: `Cache-Control: no-cache` (must revalidate)
- `/assets/*`: `Cache-Control: public, max-age=31536000, immutable` (hashed filenames)

## Data & Backups
- User data lives in browser IndexedDB (per origin). No server-side storage.
- Export/Import exists in the app (Export panel + Import controls). Users must export project files to back up work.
- Data does not transfer between origins/browsers/machines.

## Post-Deployment Verification
1. Site loads (200) with correct asset hashes
2. Project browser renders (a fresh origin shows **No projects yet**, not EP001)
3. **New project** creates a document and opens the Stage + panels
4. Play/scrub works, undo/redo works
5. Export panel functional

Note: EP001 exists only as test fixture data. A clean deployment has no demo project, so
the manual acceptance walk must create a project or import one first.

## Notes
- Phase 14 acceptance walk (manual browser test) remains pending and is listed in `docs/ROADMAP.md#acceptance-debt`.
- AI is Phase 19 and is in progress; with no provider configured the editor must remain fully functional.
