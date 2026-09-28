# ZANZA STUDIO — DEPLOYMENT GUIDE

> **Scope warning.** ZANZA STUDIO is a **static, local-first web application**. It has
> no server, no backend, no accounts, and no network calls. Deploying it means
> copying one directory of static files onto a web host. That is genuinely all there
> is, and it is not a simplification of a real deployment — there is nothing else to
> deploy.
>
> **A deployed build is not a finished product.** It will load the EP001 demo and
> play it. It has no timeline, no editing controls, and no export. See
> [`USER_GUIDE.md`](USER_GUIDE.md) § 9 and [`../README.md`](../README.md) § STATUS.

---

## 1. WHAT GETS DEPLOYED

`npm run build` produces a single self-contained directory:

```
dist/
  index.html
  assets/
    index-<hash>.js
    index-<hash>.css
    *.map
```

Three runtime dependencies (React, ReactDOM, Zustand) are bundled into the JS
chunk. There is no CDN dependency at runtime and nothing is fetched from a third
party. The application works offline once loaded.

The deployed artefact is `dist/`. Nothing else in the repository ships.

---

## 2. PREREQUISITES

| Requirement | Notes |
|---|---|
| Node.js **20 or newer** | Declared in `package.json` `engines`. Verified on 22.16.0 |
| npm 10+ | Ships with Node 20+ |
| A static file host | Any. See § 5 |
| A modern browser | See § 8 |

There is no database to provision, no API key, no environment variable, and no
`.env` file. `.env` is ignored in this repository and nothing reads it.

---

## 3. BUILD

```bash
npm ci
npm run build
```

`npm run build` runs `tsc -b` first, so **a build fails on a type error**. This is
intentional: a broken type must not reach a deployed bundle.

The build writes to `dist/`, which is git-ignored. To also produce source maps and
verify the bundle, note that `vite.config.ts` sets `sourcemap: true`, so `.map` files
are emitted into `dist/assets/`. They are useful when debugging a deployed build.
If you would rather not ship readable source to a public host, set
`build.sourcemap` to `false` — but do not change it in the same commit as anything
else, and say so in the message.

### Gates

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

## 4. CRITICAL: THE BUILD MUST BE SERVED OVER HTTP

**Opening `dist/index.html` directly from the filesystem will not work.**

`file://` origins are opaque and are denied IndexedDB access by every current
browser. The application stores the project in IndexedDB, so it will fail to load or
fail to save, with only a console error to show for it.

You must serve `dist/` over `http://` or `https://`. For a local check:

```bash
npm run preview
```

then open the URL Vite prints. Use this, not double-clicking the file.

---

## 5. HOSTING

`dist/` is plain static output. Every option below works, with no configuration
beyond pointing the host at `dist/`.

| Host | How |
|---|---|
| **Netlify / Vercel / Cloudflare Pages** | Build command `npm run build`, publish directory `dist`. No framework preset needed |
| **GitHub Pages** | Publish `dist/` from a `gh-pages` branch or `/docs`. **Read § 6 first** |
| **S3 + CloudFront** | Upload `dist/`, set `index.html` as the index document |
| **Nginx** | `root /var/www/zanza; index index.html;` |
| **Any web server** | Serve the directory. That is the entire requirement |

### No SPA rewrite needed

The application uses no client-side router, so there are no deep links to rewrite. A
`try_files $uri /index.html` rule is harmless but unnecessary, and no route will ever
request a path that does not exist.

---

## 6. SUBPATH HOSTING (`base`)

`vite.config.ts` does **not** set `build.base`, so it defaults to `/`. The built
`index.html` requests `/assets/index-<hash>.js`.

If you host under a subdirectory — `example.com/zanza/`, or a GitHub Pages project
site at `user.github.io/zanza-studio/` — the app will load a blank page, because the
absolute asset paths resolve to the domain root.

Fix it by setting the base at build time:

```bash
npm run build -- --base=/zanza-studio/
```

For a permanent change, set it in `vite.config.ts` using an env var so one codebase
can target both root and subpath hosts:

```ts
export default defineConfig({
  base: process.env.PUBLIC_BASE ?? '/',
  // ...
});
```

Then `PUBLIC_BASE=/zanza-studio/ npm run build`.

**No git remote is currently configured on this repository**, so there is no
determined deployment target yet. Decide on a host, then apply the matching section
above. Do not add a deployment section to this guide for a host that is not in use.

---

## 7. CACHING

A stale `index.html` is the single most common way to ship a broken deploy: the
browser keeps the old HTML, which points at asset hashes that the new deploy has
deleted, and the app fails to boot.

Configure the host so that:

| Path | `Cache-Control` |
|---|---|
| `/index.html` | `no-cache` (must revalidate every load) |
| `/assets/*` (hashed filenames) | `public, max-age=31536000, immutable` |

Vite fingerprints the filenames under `assets/`, so those are safe to cache forever.
`index.html` is the only file that changes name-lessly and must be revalidated.

---

## 8. BROWSER SUPPORT

| Browser | Support |
|---|---|
| Chrome / Edge 111+ | Supported |
| Firefox 128+ | Supported |
| Safari 16.4+ | Supported |

This is the floor set by the Vite build target (`es2022`) plus IndexedDB and Canvas
2D. No polyfills are shipped and none are needed.

Rendering uses the native Canvas 2D API, so it is GPU-composited by the browser and
depends on the host machine's graphics driver. ZANZA STUDIO is a desktop-class tool
and is not designed for phones or tablets.

---

## 9. DATA, STORAGE, AND BACKUPS

This is the part that matters operationally, because **the deployed application is
not a website — it is a local tool with no server-side copy of anything.**

- Projects live in the **visitor's own browser**, in IndexedDB, keyed to the exact
  origin they loaded from. `https://a.example/` and `https://b.example/` are two
  different, unrelated databases.
- A new visitor receives the **in-memory EP001 seed**, which is regenerated on every
  load and is not written to the database. First run and thousandth run are identical.
- **Nothing the user creates ever reaches your server.** There is nowhere for it to
  go.
- Consequently: **the user cannot recover their work by contacting you, and you
  cannot recover it either.** Clearing site data, or using a different browser or
  machine, destroys it.

This is a deliberate consequence of `AGENTS.md` RULE 10, not an oversight. The
mitigation is project import/export, which is planned for Phase 12 and **does not
exist yet**.

**Until Phase 12 ships, do not tell users to rely on this application for work they
cannot afford to lose.** That is the honest operational position.

---

## 10. UPGRADING AN EXISTING DEPLOYMENT

1. Pass the gates locally: `npm run verify`.
2. Tag the release: `git tag v0.1.0`.
3. Deploy the new `dist/` over the old one.
4. Existing users reload and get the new bundle.

There is no database migration, because the schema lives in the browser and is
versioned by the document format's own `version` field. The loader accepts the
current version and refuses others rather than guessing, so a document written by a
newer build fails loudly instead of being silently mangled.

**Keep the previous `dist/` until you have confirmed the new one boots.** A static
host makes rollback a matter of re-uploading the old directory.

---

## 11. AUTOMATION

**There is no CI configured.** `.github/` does not exist. Every gate in § 3 is run by
hand, which means every deployment is a person vouching for it.

The minimum worth adding, in order of value:

1. A CI job on push and pull request running `npm ci && npm run verify`.
2. A deploy job that publishes `dist/` only when that job passes.
3. Branch protection requiring the first job to pass before merge.

Until (1) exists, treat the four gates as a manual ritual, not an enforced one.

---

## 12. CHECKLIST

- [ ] Node 20+ available
- [ ] `npm ci`
- [ ] `npm run verify` — all four gates green
- [ ] `base` matches the host's path (§ 6)
- [ ] Served over `http`/`https`, never `file://` (§ 4)
- [ ] `index.html` is not cached; hashed assets are (§ 7)
- [ ] Previous `dist/` retained for rollback
- [ ] Users told their work is browser-local and not backed up (§ 9)
- [ ] You have accepted that this deploy is a demo, not a usable editor (§ 9, `USER_GUIDE.md` § 9)
