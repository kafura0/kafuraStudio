# ZANZA STUDIO — DEPLOYMENT GUIDE

> **Scope.** ZANZA STUDIO is a **static, local-first web application**. It has no server,
> no backend, no accounts, and no network calls. A deployed build is a **working editor**:
> the project browser, stage, timeline, dialogue, camera, audio, undo/redo and export all
> run entirely in the browser. There is no database to provision and no API key to set.
>
> The one honest operational caveat: the application is **local-first**. Everything a user
> creates lives in the browser's IndexedDB, per origin, so § 8 (Data & Backups) applies.
>
> This document is the canonical deployment guide. `docs/DEPLOY.md` is the long-form
> rationale; where the two disagree, this file wins.

---

## 0. STATUS

| Aspect | State |
|---|---|
| Build output | `dist/` (static, self-contained) |
| Runtime dependencies | React, ReactDOM, Zustand — all bundled. No CDN, works offline |
| Backend | None. No network calls at runtime |
| Persistence | Browser IndexedDB, per origin |
| AI layer | **Plan 19, in progress.** With no provider configured the editor is fully functional (gate G3) |
| CI | None configured. Every gate is run by hand (§ 6) |

---

## 1. PREREQUISITES

| Requirement | Notes |
|---|---|
| Node.js **20 or newer** | Declared in `package.json` `engines`. Verified on 22.16.0 |
| npm 10+ | Ships with Node 20+ |
| A static file host | Any. See § 5 |
| A modern browser | See § 7 |

There is no database, no API key, no environment variable, and no `.env` file. `.env` is
ignored in this repository and nothing reads it.

---

## 2. BUILD

```bash
npm ci
npm run build
```

`npm run build` runs `tsc -b` first, so **a build fails on a type error**. That is
intentional: a broken type must not reach a deployed bundle. The build writes to `dist/`
(git-ignored) and fingerprints asset filenames.

`vite.config.ts` sets `sourcemap: true`, so `.map` files are emitted into `dist/assets/`.
They help when debugging a deployed build. If you do not want to ship readable source to a
public host, set `build.sourcemap` to `false` — but not in the same commit as anything
else, and say so in the message.

### Gates (RULE 8)

`npm run build` alone is not sufficient. The full gate is:

```bash
npm run verify
```

which runs, in order, and stops on the first failure:

| Gate | Command | What it catches |
|---|---|---|
| Lint | `npm run lint` | Rule violations, unused code, hook misuse |
| Types | `npm run typecheck` | Any type error |
| Tests | `npm run test` | Behavioural regressions |
| Build | `npm run build` | Anything the bundler rejects |

**Do not deploy a build that has not passed all four.** This is `AGENTS.md` RULE 8.

---

## 3. CRITICAL: THE BUILD MUST BE SERVED OVER HTTP

**Opening `dist/index.html` directly from the filesystem will not work.**

`file://` origins are opaque and are denied IndexedDB access by every current browser. The
application stores projects in IndexedDB, so it will fail to load or fail to save, with only
a console error to show for it.

Serve `dist/` over `http://` or `https://`. For a local check:

```bash
npm run preview
```

then open the URL Vite prints. Use this, not double-clicking the file.

---

## 4. HOSTING

`dist/` is plain static output. Every option below works with no configuration beyond
pointing the host at `dist/`.

| Host | How |
|---|---|
| **Vercel / Netlify / Cloudflare Pages** | Build command `npm run build`, output/publish directory `dist`. No framework preset needed |
| **GitHub Pages** | Publish `dist/` from a `gh-pages` branch or `/docs`. **Read § 5 first** |
| **S3 + CloudFront** | Upload `dist/`, set `index.html` as the index document |
| **Nginx** | `root /var/www/zanza; index index.html;` |
| **Any web server** | Serve the directory. That is the entire requirement |

### No SPA rewrite needed

The application uses no client-side router, so there are no deep links to rewrite. A
`try_files $uri /index.html` rule is harmless but unnecessary.

### Linked remote

The repository has a `git` remote at `https://github.com/kafura0/kafuraStudio.git`
(branch `main`). A Vercel project has been linked to it; **push to `main` to trigger a
production deployment**. If you deploy elsewhere, apply the matching row above. Do not add
a deployment section to this guide for a host that is not in use.

---

## 5. SUBPATH HOSTING (`base`)

`vite.config.ts` does **not** set `build.base`, so it defaults to `/`. The built
`index.html` requests `/assets/index-<hash>.js`.

If you host under a subdirectory — `example.com/zanza/`, or a GitHub Pages project site at
`user.github.io/zanza-studio/` — the app loads a blank page, because the absolute asset
paths resolve to the domain root. Fix it by setting the base at build time:

```bash
npm run build -- --base=/zanza-studio/
```

For a permanent, dual-target setup, read the base from an env var in `vite.config.ts`:

```ts
export default defineConfig({
  base: process.env.PUBLIC_BASE ?? '/',
  // ...
});
```

then `PUBLIC_BASE=/zanza-studio/ npm run build`.

---

## 6. CACHING

A stale `index.html` is the single most common way to ship a broken deploy: the browser
keeps the old HTML, which points at asset hashes the new deploy has deleted, and the app
fails to boot. Configure the host so that:

| Path | `Cache-Control` |
|---|---|
| `/index.html` | `no-cache` (must revalidate every load) |
| `/assets/*` (hashed filenames) | `public, max-age=31536000, immutable` |

Vite fingerprints the filenames under `assets/`, so those are safe to cache forever.
`index.html` is the only file that changes name-lessly and must be revalidated.

---

## 7. BROWSER SUPPORT

| Browser | Support |
|---|---|
| Chrome / Edge 111+ | Supported |
| Firefox 128+ | Supported |
| Safari 16.4+ | Supported |

This is the floor set by the Vite build target (`es2022`) plus IndexedDB and Canvas 2D. No
polyfills are shipped and none are needed. Rendering uses the native Canvas 2D API, so it is
GPU-composited by the browser. ZANZA STUDIO is a desktop-class tool and is not designed for
phones or tablets.

---

## 8. DATA, STORAGE, AND BACKUPS

This part matters operationally, because **the deployed application is not a website — it is
a local tool with no server-side copy of anything.**

- Projects live in the **visitor's own browser**, in IndexedDB, keyed to the exact origin
  they loaded from. `https://a.example/` and `https://b.example/` are two unrelated
  databases.
- **A fresh origin opens to an empty project browser.** It shows **"No projects yet"**, not
  a demo. A user must choose **New project** (which scaffolds a neutral, non-canon starter
  library — see § 1 of `docs/ARCHITECTURE_SPEC.md`) or import a project file to begin.
  There is **no in-memory EP001 seed written to the database.** `SEED_PROJECT` and
  `SEED_SERIES` exist **only as test fixtures** in `src/data/seed.ts`; nothing in the running
  application installs them.
- **Nothing a user creates ever reaches your server.** There is nowhere for it to go.
- Consequently: **the user cannot recover their work by contacting you, and you cannot
  recover it either.** Clearing site data, or switching browser or machine, destroys it.

This is a deliberate consequence of `AGENTS.md` RULE 10, not an oversight. The mitigation is
**project import/export, which is implemented** (`src/core/io/projectIo.ts`, reached from the
Import/Export controls in the workspace): a user exports a portable project file and imports
it to recover work on another origin, browser or machine. Because a deployed build is static,
export is a file download and import is a file picker — there is no server to push to, and
the file is self-contained.

**That is the honest operational position:** work is browser-local, and the recovery path is
"export the project file, store it somewhere of your choosing, import it when you need it."
Tell users this up front.

---

## 9. POST-DEPLOYMENT VERIFICATION

Run this against the freshly deployed origin, before telling anyone it is live.

- [ ] Site loads (HTTP 200) with correctly hashed assets; no console errors on boot
- [ ] Project browser renders and shows **"No projects yet"** (a clean origin has no EP001)
- [ ] **New project** creates a document and opens the Stage + panels
- [ ] Play and scrub work; undo and redo work
- [ ] Export panel produces a download
- [ ] Reloading the page restores the open project from IndexedDB

> **Acceptance walks** (the Phase 14 series walk, the Phase 15 600-frame performance pass,
> the Phase 18 review-panel walk) require a project to exist first. On a clean origin,
> create or import one before starting them. These walks are tracked as open debt in
> `docs/ROADMAP.md#acceptance-debt`.

---

## 10. UPGRADING AN EXISTING DEPLOYMENT

1. Pass the gates locally: `npm run verify`.
2. Tag the release: `git tag v0.1.0`.
3. Deploy the new `dist/` over the old one.
4. Existing users reload and get the new bundle.

There is no database migration to run, because the schema lives in the browser and is
versioned by the document format's own `formatVersion` field. The loader migrates a known
older version and refuses an unknown one rather than guessing, so a document written by a
newer build fails loudly instead of being silently mangled.

**Keep the previous `dist/` until you have confirmed the new one boots.** A static host
makes rollback a matter of re-uploading the old directory.

---

## 11. AUTOMATION

**There is no CI configured.** `.github/` does not exist. Every gate in § 2 is run by hand,
so every deployment is a person vouching for it. The minimum worth adding, in order of
value:

1. A CI job on push and pull request running `npm ci && npm run verify`.
2. A deploy job that publishes `dist/` only when that job passes.
3. Branch protection requiring the first job to pass before merge.

Until (1) exists, treat the four gates as a manual ritual, not an enforced one.

---

## 12. CHECKLIST

- [ ] Node 20+ available
- [ ] `npm ci`
- [ ] `npm run verify` — all four gates green
- [ ] `base` matches the host's path (§ 5)
- [ ] Served over `http`/`https`, never `file://` (§ 3)
- [ ] `index.html` is not cached; hashed assets are (§ 6)
- [ ] Post-deployment verification run on the live origin (§ 9)
- [ ] Previous `dist/` retained for rollback
- [ ] Users told their work is browser-local, and export/import is the recovery path (§ 8)
