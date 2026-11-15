# tools/README.md

## Verifier discipline

Every verifier in `tools/` must demonstrate failure on a known-bad input before its pass output is
trusted.

This is not a stylistic preference. In a single cycle, five separate verifier bugs were found, each
only by hand, and each one reported a confident wrong number:

1. A case-insensitive `[A-Z ]+` regex deleted real content **from the source**, making correct
   extractions look like drift. Reported **96.5% pass**; the true figure was 100%.
2. Page furniture not stripped from the source, reporting **0 of 65 pass**.
3. The ASCII hyphen missing from `norm()`, so a de-hyphenated body could never equal the source.
4. An injected `**Amendments:**` label breaking contiguity of an otherwise perfect body.
5. An ad-hoc counting script matching `under Rule 52(b)` as a "captured foreign heading",
   reporting **121 defects** where the real figure was 0.

The pattern: **a verifier that reports 0% or 100% is usually describing itself.** Suspect the
instrument before the data.

Positive controls live in `test_federal_rules.js` and run on every invocation. They mechanize what
used to be manual: containment must fail on a deleted phrase, the small-caps detector must report an
injected split, and a contents line appended to a body must break containment. Each control is
paired with a control-0 that must PASS, so a control cannot pass by always failing.

**Ad-hoc verification scripts get the same discipline as production verifiers.** Instance 5 above was
a throwaway one-liner. The operator's own tooling is subject to the same failure modes as the code.

## Write-then-verify must be sequenced, not merely discouraged

Reading a file that another process is still writing produces a plausible, wrong answer. This
happened: two commands ran in parallel and one read a corpus file mid-rewrite, reporting a leak that
had already been fixed.

So the chain is structural, not habitual: `tools/build-federal-rules.js` runs extract → verify → test
in order, one stage at a time, and stops on the first failure. Do not run the stages by hand in
parallel.

## The extractor's heading heuristic, and one correction worth preserving

For rule-shaped documents:

- **A contents entry is never body text.** Any line containing a run of four or more dots is a
  table-of-contents entry *wherever it appears* — excluded as a heading **and** excluded from any
  body span. Excluding it only as a heading is not enough: a body span runs from one heading to the
  next, so a mid-document contents block, which contains no headings, sits entirely inside the
  preceding rule's body. That is what leaked FRBP's Part VII contents into Rule 7052.

- **For a duplicated number, prefer the occurrence followed by rule content.**

  ⚠️ **Not "prefer the last occurrence."** That was proposed and it is wrong. Measured
  counter-example: FRE Rule 107's *later* occurrence is an empty heading; the *earlier* one is the
  real rule (`duplicate headings: 107 (kept: earlier, 909 chars vs 0)`). "Prefer last" would delete
  Rule 107. The keep-the-longer-body tie-break approximates the correct rule.

  Recorded because the wrong version is plausible and was proposed once already.

## Before scaling to the US Code

Rule A above covers title-level and chapter-level tables of contents. USC also carries furniture that
Rule A does **not** cover, and each needs a rule before extraction begins rather than after:

| Variant | Signal | Rule needed |
|---|---|---|
| Two-column cross-reference tables | Tab-separated, no dot leaders | Detect tab-column layout; treat as furniture |
| "Short Title" / "Effective Date" sections | Heading followed by a single sentence | Decide whether these are body text or furniture |
| Year-prefixed amendment notes (`2018—Subsection (a) amended…`) | Leading 4-digit year + em dash | Split into frontmatter `amendments` |
| Historical notes (`(Pub. L. 100-000, …)`) | Parenthetical with public-law citation | Split into frontmatter, like amendment history |
| `Sec.`-style contents lines without dot leaders | Line beginning `Sec.` | Page-number or caption detection, not dot-leader detection |

Finding one of these after extraction is expensive. Listing them before is a paragraph of planning.

## Verify every path and function name against the repo before drafting a plan

A plan is an instrument too, and it earns the same discipline as a verifier: it must be shown to match
the artifact before anything is built on it.

One plan for the whiteboard feature was wrong on **every one of its file-system claims**:

| The plan assumed | The repo had |
|---|---|
| `src/pages/AIAssistant.tsx` is a separate page | only `Assistant.tsx` — one page, already wired |
| delete is not wired on the AI Assistant surface | wired end to end (`Assistant.tsx:203`, `preload.js:230`, `main.js:3041`) |
| `aiStream.ts` holds the streaming→BIA swap behind a size threshold | zero occurrences of `formatBia` / `biaHtml` in that file |
| `src/components/layout/SideNav.tsx` | `Sidebar.tsx` |
| bundle `tesseract.js` | a prior decision **not** to bundle it, recorded in `main.js`'s `ocr:image` |

Each would have produced work in the wrong place; the last would have silently reversed a recorded
decision. The state machine was probed against a real PDF before it was written and worked first time.
The plan was not probed and was wrong on 100% of its file claims.

**Before drafting or accepting a plan, grep for every path and every named function it mentions.** A
plan that names a file which does not exist cannot be implemented, only worked around.

## A silent failure is worse than a visible one

The four-tier formatter is a *second* model call. When it fails — dead API key, network drop, provider
outage, empty result — the answer degrades to unformatted text. That degradation was originally
**silent**: the user saw raw `<strong>` tags and literal markdown with nothing to explain why. A real
problem (formatting unavailable) presented as a different problem (broken formatting), and it cost a
full diagnostic cycle before the chain was traced.

`ChatBubble` now renders an explicit notice and a `Retry formatting` action whenever the formatter was
attempted and returned no artifact — and deliberately does **not** show it when formatting was bypassed
on purpose (Socratic/dialogue passthrough returns success with a null artifact). Flagging an intended
plain-text answer as a failure would replace a silent bug with a lying one.

The rule generalises: **when a fallback path exists, it must say that it is a fallback.** A fallback
that is indistinguishable from the intended output hides the failure it exists to absorb.

## A persistence format must carry every field the renderer needs

Two bugs in this project have the same shape, and it is worth naming once rather than rediscovering
per surface:

> **The write path stores what the live session happened to have. The read path reconstructs
> something else. Nothing fails loudly; the view is simply different after a reload.**

**Reload, formatting lost.** The live session held `content` *and* `biaHtml`. Storage wrote
`biaHtml ?? answer` — a single composite field, discarding the distinction. On reload the loader
returned `{ id, role, content }`, so the formatted HTML came back as `content` and the renderer
treated HTML as markdown, displaying raw `<strong>` tags. Persisting both fields as separate
delimited blocks (`<<<BIA>>>…<<<END>>>`, alongside the existing `<<<REASONING>>>`) is what makes the
reload view identical to the live view.

**Delete, message returns.** The live session held the message in state. Storage wrote a tombstone.
The read path did not filter against it, so a deleted turn came back on the next load.

Both were fixed by making the read path read *everything the write path wrote*. The check to run
before adding any persistence layer: **list the fields the live view uses, then confirm the file
format carries each one, then confirm the loader restores each one.** A field that survives only in
memory is a bug that appears on the next launch, when it is hardest to attribute.

## Instance 14 — verify a function's return SHAPE, not just its name

`callDeepSeekMain` was assumed to return `{ content, reasoning }`. **It returns a string** — it
resolves `choice.content`, or the salvaged tail of the reasoning trace when the model thought but
did not answer. Code that read `out.content` and `out.reasoning` off it got `undefined` from both,
and the feature reported *"the model returned nothing"* against a call that had **succeeded**.

The symptom is what makes this dangerous: 1.3 s and an empty result reads as an API problem or a
truncation problem, and two wrong diagnoses (an over-ceiling `max_tokens`, then a reasoning model
burning its budget) were formed before anyone read the function's `return` statements.

**Before relying on any field of a function's result, read the actual `return` lines.** A name tells
you what to call; it tells you nothing about what comes back.

## Instance 15 — read the process's stderr before auditing your own diff

When the app failed to start and `boot.log` was **silent** — no `whenReady fired`, no `loadFile`, no
`did-finish-load` — the natural conclusion was a code defect, and two turns went into auditing a diff
that was clean. Capturing Electron's stderr answered it in 30 seconds:

```
App threw an error during load
Error: Cannot find module './internal/re'
  ← jsons\node_modules\conf\node_modules\semver\index.js
```

A silent log means the failure is **upstream of logging**. Inference is the failure mode here;
observation is the fix.

### The corollary, and the category behind it

**Never run a packager concurrently with npm.** The `node_modules` tree is a shared mutable
resource. An install writing it while electron-builder reads it produces partial-tree corruption
whose symptoms — a missing module from a random package — are indistinguishable from a code defect.

Three separate corruption events in one session, all the same shape — **a resource read while it was
being written**:

| Event | Cause | Symptom |
|---|---|---|
| `semver/internal/re.js` missing | npm install hit the command timeout, killed mid-write | app threw on load, no log output |
| `fs-extra/lib` at 6 entries, should be 9+ | npm started 24 s before the packager | packager died at signing with no error |
| `conf` (earlier) | same class | `electron-store` failed to initialize |

None were application bugs. Every one was a **synchronization** problem in the tooling around the
application — and each was first misdiagnosed as a code defect.

Two guards worth keeping:

- **Serialize** anything that touches `node_modules`. Install must fully return before a packager starts.
- **A packager that vanishes mid-log with no error has been killed, not failed.** Check whether the
  artifact's timestamp actually moved before believing a build succeeded.

Also worth knowing: `npm install` exiting 0 does **not** mean the tree is intact. npm considers a
package installed and never re-verifies file contents, so a partially-written package survives an
install. Repairing one requires **deleting the package directory** so npm has to reinstall it.

### Measure the live artifact, not a cached copy of it

A stale `dist\win-unpacked` at the repo root was checked in place of `jsons\dist\win-unpacked`, and
three separate reports of "the packager failed" were derived from a directory the packager never
wrote to. It was stale **and internally consistent** — old asar, no exe — so every check of it
returned a coherent "the build produced nothing", and the exe's absence looked like proof. The
correct path had been in the build output the whole time (`appOutDir=dist\win-unpacked`, relative to
the project dir it also logged).

Same shape as reading `node_modules` mid-install: **the resource being read was not the resource
being written.** Before concluding a build failed, confirm the artifact's timestamp actually moved,
and confirm you are looking where the tool said it writes.

Corollary, learned the same day: **grep every shipped file, not one of them.** A check of
`dist/prod/index.js` alone reported 0 occurrences of `getDimensions` and was written up as "that
option does not exist in 0.18.1". It exists, in `chunk-K2UTITRG.js`. A partial read is as
misleading as a stale one.

### Audit the tree instead of fixing one package per build

Four packages in this session were partially installed — `conf`, `semver`, `fs-extra`, and
`dompurify` (which shipped without its declared ESM entry, `purify.es.mjs`) — plus
`@mermaid-js/parser`, which was present but contained **only `.mjs.map` files and no code at all**.
Each was found only when something imported it, one build at a time.

The fix is not another round of whack-a-mole. Walk `node_modules`, read each `package.json`, and
check that every declared entry (`main`, `module`, `types`, and each `exports` target) exists on
disk. That is filesystem-only, takes seconds, and finds them all at once — 5 broken packages out of
1074, in one pass, after the build had surfaced them one per 90 seconds.

Two refinements that matter, or the audit cries wolf:

- Resolve extension-less `main` values (`"index"` → `index.js`, and a directory index). Without it,
  every package with a bare `main` is reported as corrupt.
- Treat missing `.d.ts` targets as advisory. `@babel` and others routinely declare type paths they
  never ship; flagging them buries the real hits.

**A package that is still reported after a clean reinstall is shipped that way, not corrupt.** The
five survivors were all missing a CJS entry (`dist/main.js`, `dist/index.cjs`) while their ESM entry
was present — harmless to a Vite ESM build. Reinstalling is what distinguishes corruption from
design.


