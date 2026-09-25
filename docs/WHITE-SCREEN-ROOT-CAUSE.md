# The white window: root cause and the gates that now prevent it

Three DMGs shipped whose app window opened blank. The fault was not in the renderer, not in
the corpus walk, and not in signing. It was a build-time environment variable — and every
instrument used to look for it was measuring the wrong thing.

## What was actually wrong

`src/lib/supabase.ts` ran this at module scope:

```ts
const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL      as string
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string
export const supabase = createClient(supabaseUrl, supabaseAnon)
```

`import.meta.env.*` is replaced at **build** time. When the values are absent, Vite inlines
`void 0`, and supabase-js validates its URL in the constructor:

```js
Dl(e){let t=e?.trim();if(!t)throw Error(`supabaseUrl is required.`);…}
```

So the bundled text was literally `Ml = Al(void 0, void 0)`, and evaluating the bundle threw
before React ran. `createRoot().render()` in `main.tsx` never executed, `#root` stayed empty,
and the window showed nothing.

### Evidence, read out of the artifacts themselves

| Artifact | Bundle | Client construction |
|---|---|---|
| Shipped macOS DMG / zip (`app.asar` from the verified zip) | `index-nhQhkKcO.js`, 614,532 B | `Ml = Al(void 0, void 0)` — **throws** |
| A local Windows repack | `index-DdlUZuAJ.js`, 589,339 B | `G("https://…supabase.co", "sb_publishable_…")` — boots |

Both came from the same source. The only difference was whether the build had credentials
inlined.

## Why three releases went out anyway

**1. `ready-to-show` does not mean "React mounted".** Electron fires it on the window's first
paint, and `backgroundColor: '#F8F9FA'` *is* a paint, so it fired on every broken build.
`did-finish-load` (HTML parsed) also fired. The observable log therefore said the renderer was
fine while the user was looking at a white window, and every conclusion drawn from those
events was unfounded.

**2. Two `dist-react` trees.** `vite build` wrote to the repo-root `dist-react/`, but
`electron-builder` resolves `files` relative to the app dir (`jsons/`) and so packaged
`jsons/dist-react/`. CI papered over the disagreement with `cp -R dist-react jsons/dist-react`.
Locally nothing did: every `electron-builder --dir` packaged whatever stale bundle happened to
sit in `jsons/dist-react/`. That is how a Windows test run "passed" on a bundle containing the
URL while the shipped build — staged correctly by CI from an unconfigured build — did not. The
Windows reproduction was never a reproduction.

**3. The configuration was invisible.** The real values live in `jsons/.env`, which is
gitignored. `vite.config.ts` set `envDir: projectRoot`, and Vite reads env from exactly one
directory, so `jsons/.env` was silently never read. The same defect produced the other reported
symptom — "adding to vault received a supabase error" — because the client was never
legitimately configured at all.

## The fix

- **`src/lib/supabase.ts`** — never construct a client from a falsy URL. Values are coerced,
  and a placeholder (`https://unconfigured.supabase.invalid`) is substituted when they are
  absent, so an unconfigured build boots and degrades instead of dying. `isSupabaseConfigured`
  is exported so callers can skip requests that could only fail.
- **`jsons/vite.config.ts`** — merges env from **both** the project root and `jsons/`, so a
  value in either location is honoured, and warns loudly when the Supabase pair is missing.
- **`jsons/vite.config.ts`** — writes to `jsons/dist-react/`, the directory the packager reads.
  One renderer tree, no copy step, nothing to go stale.
- **`.github/workflows/build-mac.yml`** — injects `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` from repository secrets and **fails the build** when they are
  absent; asserts the inlined host is present in the packaged bundle; no longer copies the
  renderer.
- **`jsons/main.js` / `src/App.tsx`** — a renderer-reported mount (`app:renderer-mounted`, sent
  from an effect inside the provider tree) replaces `ready-to-show` as the signal that clears
  `failedLaunches`. Uncaught renderer errors are now forwarded to `boot.log`.

## What made the fix verifiable

`renderer MOUNTED` can only be written by an effect that runs after a real commit inside
`App.tsx`'s provider tree. It is the one signal that means what it says. Measured under the
exact failing condition — no Supabase secrets anywhere:

```
18:15:53.321  renderer console: [supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY were
                                not present at build time … the Vault saves locally
18:15:53.406  renderer MOUNTED  (React committed in the provider tree; failedLaunches -> 0)
verdict: renderer MOUNTED: PRESENT      renderer fault: none
```

and again configured, with the real host inlined and no warning:

```
18:17:11.529  ready-to-show  (window has an initial paint; this does NOT prove React mounted)
18:17:11.573  renderer MOUNTED  (React committed in the provider tree; failedLaunches -> 0)
```

44 ms apart — and only the second one ever appeared in the broken builds.

## Gates that now stand in front of it

1. The **type check** (`tsc -p .tsc-check.json`) runs before anything is packaged.
2. CI **refuses to build** without the Supabase secrets.
3. CI **asserts the inlined Supabase host** exists in the packaged `app.asar`, so a bundle that
   cannot boot cannot be signed, DMG'd, or released.
4. The bundled renderer no longer throws when unconfigured, so the failure mode is degraded
   rather than fatal.

## Vault behaviour after the fix

Adding to the Vault is now local-first in both places that offer it
(`OutlineGenerator.tsx` and `DocumentVault.tsx`): the artifact is written to
`Documents/Bianna_Law/Vault/` with a taggable `index.json` sidecar, and Supabase is mirrored
afterwards only when the build was configured. When the cloud copy fails — or is absent — the
UI says exactly that ("Saved in the app Vault ✓ (cloud sync unavailable)") and offers the file
route: Word, PDF or HTML, chosen by her, then saved to a folder she picks or kept in the app
Vault. Closing the app with unsaved work is intercepted and asks the same question instead of
discarding it.

## Unrelated defects, unchanged by this fix

Tracked separately; none of them is part of the white-window fault:

- **`docs/KNOWN-CONTENT-ISSUES.md`** — three confirmed content errors (Wills § 732.601 wrong
  proposition; *Heien* concurrence labelled a dissent; a fabricated *J.L.* quotation).
- **`docs/CORPUS-DEFECTS.md`** — 843 of 24,670 statute files flagged (3.42%), with the
  mechanical cause in § 732.601: a mid-attribute splice that dropped the tail of (3) and all of
  (4), and an off-by-one section number in the metadata lines. Regeneration is deferred and
  gated behind the P-0 structural check described there.

## The verified artifact

Built by CI from `d07fde97` on `v1.2.0-release` (run 36173526264), then checked by reading the
shipped `app.asar` rather than trusting the build log:

```
bundle: dist-react/assets/index-B_xwjl13.js (621,413 bytes)
  guard "supabaseUrl is required" present : true   (the library is there, as it always was)
  inlined Supabase host                   : https://aparjezcomoxlbicyegm.supabase.co
  client built from void 0                : no
SHIPPED_ARTIFACT_VERDICT=PASS
```

| file | sha256 | bytes |
|---|---|---|
| `Senior Law Partner-1.2.2-arm64.dmg` | `e98dc84aa55ba546ab96a7fb2d344ca922916463367c428daaec3d1068f942a9` | 168,402,101 |
| `Senior-Law-Partner-1.2.2-arm64.zip` | `6230e8dde5051712c1ea13304b4f94f93c0499237715ce0fdd132e789ef3aa3b` | 167,843,215 |

For contrast, the previous DMG — kept as
`archive/Senior-Law-Partner-1.2.2-arm64-BROKEN-white-screen.dmg` — contained
`Ml = Al(void 0, void 0)` and no Supabase host at all.

Both export formats were verified by reading the generated files back, not by assuming:
the `.docx` unzips to a `word/document.xml` carrying the title (with Word's `Title` heading
style), the subtitle and the section symbol; and `pdf-parse` reads the title, subtitle,
heading and body text out of the PDF. That check is what caught the untitled-PDF defect,
which a structural "is it a valid PDF" test could not.

### Required before the next release

CI now refuses to build without the Supabase credentials, and asserts the inlined host is
present in the packaged bundle. `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set on the
repository. The unused `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` pair that had been
sitting there unread for six months was removed: two plausible sources for the same credential
is part of how this went unnoticed.

