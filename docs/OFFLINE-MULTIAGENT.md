# Offline multi-agent mode

Offline mode answers questions with **no network and no API key**. It is not a smaller model; it
is a different kind of system with a smaller failure surface.

**One invariant governs all of it:** no text is ever generated. Every response is either

1. verbatim retrieval from the bundled Florida Statutes,
2. a value from a hand-authored JSON file, or
3. a pattern-matched reflection that answers nothing but keeps the student talking.

There is no model call and no interpolation of legal content anywhere in this path. The system
can be silent or incomplete, but it cannot invent a rule — which is the failure that put a wrong
proposition into the Wills packet.

## Why multi-agent rather than one ELIZA

A single generalist pattern-matcher has to be fuzzy to fire at all: every pattern competes with
every other pattern for every input. Each specialist can be strict because its domain is narrow,
and — the part a generalist cannot have at all — a specialist owns a **negative list**. The Wills
agent refuses `consideration`, `hearsay`, `proximate cause`, `venue`. That is why
"what are the elements of consideration" produces a clarification instead of a confident,
irrelevant statute.

Four axes differentiate an agent, and all four are data files:

| Axis | File | What it changes |
|---|---|---|
| Vocabulary register | `vocab.json` | doctrine scoring, and the negative list |
| Question grammar | `question-shapes.json` | which question type a message is |
| Response structure | `templates.json` | the shape of the answer |
| Conversational rhythm | `rhythms.json` | what the agent reflects back, in its own register |

## Layout

```
jsons/offline/                  code (discipline-agnostic)
  corpus.js                     guarded verbatim reads + catchline search + ranking
  router.js                     dispatch and scoring
  index.js                      agent runner, responders, ask()
jsons/data/offline/             data (the agents)
  router.json                   active agents + strong signals + chapter scope
  shared/                       known-defects.json, reflection-patterns.json
  agents/wills-trusts/          vocab, question-shapes, templates, rhythms,
                                gloss-rules, doctrine-map.wills.json,
                                doctrine-map.trusts.json
```

`doctrine-map*.json` is merged by glob, so a doctrine map can grow by adding a file rather than
editing one. Adding a ninth discipline means adding one folder and one router entry; no code
changes.

`jsons/offline/**` and `jsons/data/offline/**` were added to the electron-builder `files` list.
**That matters:** `files` is resolved from `jsons/`, so anything outside it is silently dropped
from the packaged app. A renderer tree outside the app dir is exactly what made every local
Windows build test a stale bundle, so new assets are added to `files` deliberately.

## The corpus problem this had to solve first

The design's promise is "retrieved, therefore correct". That promise is only as good as the
bundle, and the bundle is measurably imperfect. A full scan found:

```
8,605 of 24,668 numbered files (34.88%) contain a FOREIGN  F.S. <section>  marker in the body
Wills & Trusts, by chapter:  731 22%   732 30%   733 26%   735 20%   736 33%   738 46%
```

`732.102.md` is the worked example:

```
(2) ...the surviving spouse has no other descendant, the entire intestate estate.
F.S. 732.1016732.101          <-- the NEXT section's marker, spliced onto this one
Intestate estate.
——
(1) Any part of the estate of a decedent not effectively disposed of by will passes...
```

So § 732.101's opening is appended to § 732.102, which is itself missing subsections. Serving
that as "verbatim § 732.102" would make offline mode confidently wrong — the worst outcome
available.

`corpus.js` therefore validates every read:

- **foreign marker** → the body is cut at the marker, and the record is marked
  `tail_contaminated`. The correct text is kept; the neighbour's fragment is removed.
- **corrupt catchline** (`CHAPTER 736PART T V CREDITORS…`, `736.04086736.04`) → flagged.
- **`known-defects.json`** → § 732.601 is hard-flagged from `docs/KNOWN-CONTENT-ISSUES.md`, and
  the answer says so instead of quoting it as authority.
- **missing section** → reported, never substituted.

## What shipped in this cycle

Per the plan's instruction — *ship the Wills & Trusts reference implementation end to end before
adding the second agent* — this is the Wills & Trusts agent, complete, with the router working
against one agent as designed.

- **14 doctrines**, 91 statute references, every one verified present in the bundle by test.
- **`rule-lookup`** — verbatim section text, catchline, the curator's plain-language gloss when
  one exists, an integrity warning when the bundled copy is imperfect, and a real attribution
  line naming the file it came from.
- **`definition`** — resolves the term to the section that *defines* it. A gate refuses to answer
  unless the catchline actually contains the term, so "what is the mailbox rule?" reflects rather
  than answering with a Wills section on "rules of evidence".
- **`reflection` / `clarify` / `unavailable`** — honest non-answers. Reflection is
  discipline-shaped and suggests a next question, so a dead end still moves her forward.
- IPC `offline:ask`, exposed as `window.seniorPartner.offlineAsk`, and typed in
  `seniorPartner.d.ts`. Every call is logged to `boot.log` with its type, agent, citation and
  integrity verdict.

**Deferred, deliberately, per the plan:** drill mode, procedure playback, the other seven
agents, and the chat UI surface. The IPC is in place so the surface is a rendering job, not a
plumbing job.

## Verified

Two suites, **40 assertions, 0 failures.**

- **The retrieval invariant**, which is the whole point: for seven representative questions, the
  quoted statutory text was compared character-for-character against the bundled file. All seven
  matched. This is what proves retrieval rather than generation.
- `global.fetch` is replaced with a throwing stub *before* the module loads, so any network access
  fails loudly. All 14 varied inputs — including empty string and gibberish — still returned
  renderable text, and none attempted the network.
- The guard: splice detected and trimmed on § 732.102, its own text retained, § 732.101 clean,
  § 732.601 flagged as a known bad copy, a missing section reported rather than substituted.
- Routing: Wills and citation questions dispatch; Contracts, Evidence and greetings dispatch
  nothing and clarify instead.
- `tsc` clean; `node --check` clean on `main.js` and `preload.js`.

Two bugs were found and fixed by these tests rather than by review: the doctrine's
first-listed section was always chosen regardless of the question, and the tokenizer kept the
trailing period in `"Define ademption."` so the term never matched the catchline
`"Ademption by satisfaction."` The second was invisible in every hand-run.

## The honest capability matrix

| Query type | Online (R1) | Offline, Wills agent |
|---|---|---|
| Statute lookup | good, with hallucination risk | **excellent** — retrieval only |
| Definition | good | good, corpus-bound |
| Element breakdown | good | good when a section states the elements |
| Procedure recall | good | not implemented yet |
| Drill + answer scoring | excellent | not implemented yet |
| Cross-doctrine questions | excellent | partial (router chooses one agent) |
| Novel analysis of unseen facts | excellent | **not available** — reflects instead |
| Essay drafting | excellent | not available |

The offline mode is narrower and slower to feel smart, and on the one class of question a 2L
asks all day — *what does the statute actually say* — it is **more** trustworthy than the online
model, because it cannot misquote a section it read from disk. That is the claim worth making,
and it is the only one.

## Corpus coverage for the remaining seven agents

The eight-discipline plan is supported by the data: the bundle contains Titles 42 (Estates and
Trusts), 40 (Real and Personal Property), 39 (Commercial Relations — UCC), 45 (Torts), 46
(Crimes), 47 (Criminal Procedure), 6 (Civil Practice and Procedure), 7 (Evidence) and 15
(Homestead and Exemptions). Every discipline the plan names has statutory coverage, which was
not obvious in advance and is worth confirming before curating eight agents.

## Next steps, in order

1. **Chat UI surface** — render `offlineAsk` results with the citation, integrity badge and
   suggestions; route to it when there is no API key or no network.
2. **Torts agent** — the second agent proves the router and the pattern generalise. It should be
   pure data plus one router entry.
3. **Drill mode and procedure playback** — both are data-heavy; the engine hooks exist.
4. **Corpus regeneration (P-1c)** — attempted and **BLOCKED**; see the phase-0 section below and
   `docs/CORPUS-REGEN-REPORT.md`. The guard makes the current bundle safe; regeneration would
   make it unnecessary, but it does not yet produce corpus-grade text.
5. **Grow `gloss-rules.json`** toward the top 50 sections. Glosses are hand-authored on purpose:
   a generated gloss would reintroduce the hallucination risk offline mode exists to remove.


---

## Phase 0 boundary — corpus regeneration (2026-09-25)

**Status: BLOCKED at the gate. Phase 1 (infrastructure) and Phase 2 (the seven agents) were not
started, by design.** Full detail in `docs/CORPUS-REGEN-REPORT.md`.

The plan made regeneration a precondition and set an explicit stop condition. Both were
respected: the work stopped at the gate rather than proceeding, and nothing was written to the
live corpus — `jsons/references/florida-statutes/` is byte-for-byte unchanged, so the app still
boots from the bundle the tests were written against.

### What shipped

`tools/extract-nxt.js` — a corpus extractor for `FLDL-/2026DL/fs2026.nxt`, with five per-record
assertions. Nothing else; no corpus was replaced.

### What the assertions caught

Coverage of the gate chapter (Wills, ch. 732) went from **36/90** to **78/90** once records were
bounded correctly, and then the assertions did their job by **refusing** the contaminated output
instead of shipping it:

| Defect | Caught as | Count |
|---|---|---|
| Head-dropped continuation (stub record, body stored elsewhere) | `body too short` | 7 |
| Section bleed from a multi-section record | `body still contains markup or a catchline remnant` | 7 |

§ 732.601 — named in the plan's gate — is **rejected**, not extracted. 14 of 92 sections refused
is a 13.3% defect rate against a 5% threshold.

### What remains

Three classes, and one of them is worse than the counts suggest:

- **(a) Head-dropped continuations.** Not yet understood. The stub record for § 732.505 is 399
  bytes with no `<SECBODY>`, and the body is not in any record carrying that section's title.
  Until this is answered no coverage figure from this source can be trusted.
- **(b) Multi-section records.** 2,713 of 26,383 records hold more than one section, and the
  section-slice boundary markers are still not right for them.
- **(c) Printable framing residue — 60% of the files that passed.** The Infobase record marker
  (`LPDD`) and framing digits survive cleaning because they are printable ASCII. This is the
  highest-value fix and the most contained: build the body from `<span class="Number">` and
  `<span class="Text ...">` containers rather than cleaning a flattened string.

### What is now known, and worth carrying forward

1. `fs2026.nxt` is a **Rocket Infobase (U2) record store**, not a text file. The header says so.
2. Every record is preceded by a 19-byte marker `\x11\x06\x0B\x04\x00LPDD\x00\x00\x00\x00\x00\x13 7\xEF`
   and starts with `<!DOCTYPE html>` exactly 13 bytes later. **26,383 records.**
3. **Records are not in document order**, and a record can be truncated at a container boundary.
   Segmenting by adjacency — which is what the original scrape did — attaches the neighbouring
   section's tail to the section before it. That is the origin of the 34.88% splice defect, now
   explained rather than merely measured.
4. The text the bundle is missing for § 732.601 **is present in the source** and was recovered in
   a pre-guard run: the tail of (3) and all of (4). Regeneration is the right repair.
5. Regenerated files are correctly encoded (real `§`, real `—`), unlike the bundle's `â€”` mojibake.
6. The source has **no** `ChapterNumber` / `ChapterTitle` / `PartTitle` elements, so
   `Title → Chapter → Part` must be carried forward from the existing files or sourced separately.

The offline agents are unaffected by any of this: `corpus.js`'s integrity guard already trims the
splice at read time, so the shipped Wills & Trusts agent remains correct on the bundle it has.
Regeneration is about removing the need for that guard, and it has not earned that yet.

## Next steps, in order (revised)

1. **Finish Phase 0** — container-based body extraction (fixes (c)), then probe the stub records'
   neighbours (fixes (a)), then re-run the ch. 732 gate requiring § 732.601 and § 732.102 clean.
   Build `tools/diff-corpus.js` and measure the whole-corpus omission rate before replacing
   anything. **2–3 days.**
2. **Phase 1 (infrastructure)** — generalize the runner to load any agent folder; extend the
   router to N agents; add the arbitrator. Wills' 40 assertions must pass unchanged.
3. **Chat UI surface** — render `offlineAsk` results with the citation, integrity badge and
   suggestions; route to it when there is no API key or no network. Independent of Phase 0 and
   can proceed in parallel.
4. **Phase 2, one agent at a time** — Torts first, since it proves the router and the pattern
   generalise. 26 assertions per agent before the next one starts.
5. **Phases 3–5** — drill mode, procedures, full Windows verification, single `2.0.0` bump, one DMG.

---

## Phase 1 boundary — infrastructure, and Agent 2 (Torts) (2026-09-25)

**Status: infrastructure complete, one new agent shipped green, six agents remain.**

Corpus regeneration was **not** run in parallel, as instructed. Every agent runs against the bundle
as it stands, and the Wills integrity guard applies to all of them unchanged.

### What shipped

| File | What it is |
|---|---|
| `jsons/offline/agent-runner.js` | The generic `OfflineAgent`. Loads any agent folder; `classify()`, `respond()`, `isOutOfScope()`. |
| `jsons/offline/arbitrator.js` | Resolves a question two disciplines both claim. |
| `jsons/offline/router.js` | Extended for N agents: returns a ranked set, so the arbitrator need not re-score. |
| `jsons/offline/index.js` | Reduced to an orchestrator. 264 lines → 130. |
| `jsons/data/offline/agents/torts/` | Agent 2: 10 doctrines, 40 statutes, all verified present. |
| `tools/check-citations.js` | Grounds every citation before it is written; `--agents` re-checks them all as a gate. |
| `tools/offline-test-lib.js` | Shared harness: verbatim-quote checking, and a `fetch` stub installed before module load. |
| `tools/test_agent_torts.js` | The 26-assertion suite. |
| `tools/test_agent_wills_{a,b}.js` | The Wills suites, promoted out of scratch and made path-relative. |
| `tools/verify-win.cmd` | The harness. Non-zero exit blocks the build. |

**Verified on Windows:** `tools/verify-win.cmd` → **66 assertions, 0 failures**, and **131 statutes
across both agents, 0 missing** from the bundle.

The regression is the important number. The Wills agent's 40 assertions pass **unchanged, with no
test edits**, through a refactor that moved its entire implementation into another file and added a
second discipline beside it. That is the evidence the generalization is real rather than a second
agent bolted on.

### What the assertions caught

Six real defects, none of which review would have found:

1. **Agent over-firing.** `"What are the elements of a valid will?"` was answered by **Torts** with
   **§ 769.06, Contracts limiting liability invalid**. Wills had won the route 4–1; the arbitrator's
   "cleaner bundle copy wins" rule handed the question to the runner-up because Wills' copy of the
   section it found carried a splice warning. Fixed by scoping the arbitrator to genuinely close
   calls (margin under one strong signal): the router owns ownership, the arbitrator owns quality.
2. **A merged verdict with no text.** Two non-answers were being "merged", and the merged shape has
   no `.response`, so `text` came back `undefined` and a renderer had nothing to show. Fixed twice
   over: the merged branch carries its own text, and two non-answers are no longer merged at all —
   that was dressing up "I do not have this" as a considered conclusion.
3. **Weak tokens dispatching a discipline.** `"Is this a valid conveyance?"` routed to Wills on the
   single word *valid* and returned § 732.703, about divorce and beneficiary designations. The
   dispatch threshold is now 2, so one weak token cannot claim a question.

4. **Medical negligence answered by the general negligence doctrine.** `"What is the standard of
   care in a medical negligence case?"` returned § 768.81, comparative fault. Cause: the general
   doctrine scored higher because it owns the phrase *standard of care*. Fixed by giving the
   medical-negligence doctrine that phrase; the question now returns § 766.102.
5. **A Wills grammar defect, found by a Torts test.** `"What are the elements of a valid will?"` was
   classified `definition`, so the definition gate correctly refused to answer and reflected — while
   § 732.502 sat unused. Asking for *elements* is not asking for a *definition*. Fixed in the Wills
   question shapes; the 40 assertions still pass, and the question now retrieves.
6. **"Offer of judgment" did not route to Torts at all.** The doctrine map knew the phrase; the
   router's strong signals did not. Fixed by expanding the signal list.

Defect 5 is worth dwelling on: it was in the **reference implementation**, it was live, and it took a
second discipline's test suite to expose it. Two agents found more than twice as much as one.

### New corpus defects found while grounding citations

`tools/check-citations.js` was used for every citation, and checking content rather than mere
existence turned up damage beyond the 34.88% already documented:

- **§ 768.125 has no body at all.** Its text was replaced by the tail of § 768.12:
  `F.S. 768.126768.12   Motor vehicle colliding with any animal at large on a public highway.`
  The agent cites it, says the copy is bad, and does **not** quote the neighbour's text as its own —
  which is the behaviour the Torts suite now asserts.
- **Corrupt catchlines** in `768.0755`, `768.35`, `90.952`, `933.09`, `761.01` (e.g. `90.952`'s
  catchline is literally `F.S. 90.951690.951`). These are flagged at read time by `catchlineIsCorrupt`.

This is a further argument for Phase 0: the guard is doing more work than its documentation claims.

### The honest capability note — Con Law

The plan expected Con Law to be the weakest agent. **It is worse than the plan assumed.** The bundle
contains **no constitutional title at all**: Title 44 is civil rights (ch. 760) plus advance
directives (ch. 761, 765). There is no Florida Constitution and no case corpus, and most Con Law
questions resolve to case holdings that are not bundled. Con Law can be built honestly — tier
determination and test recall from hand-authored data, with every case-holding question routed to
reflection — but it will retrieve almost nothing, and its 10 retrieval assertions cannot be satisfied
from this corpus. **Recommend building it last, with a reduced assertion contract, documented in the
agent itself.**

### What remains

1. **Agents 3–8**, one at a time, each green before the next starts. Plan order: Contracts, Evidence,
   Property, Civ Pro, Crim Pro, Con Law. Grounding is cheap now — `check-citations.js` verified all
   40 Torts citations in a single call.
2. **Chat UI surface** — render `offlineAsk` results including `citation`, `integrity`, `note` and
   `merged`. The response objects are already shaped for it.
3. **Phase 3** — drill mode (the largest curation task) and procedure playback.
4. **Phase 5** — single `2.0.0` bump and one DMG, only when every agent is green.

---

## Live verification layer (2026-09-25)

**Status: shipped and green. `tools/verify-win.cmd` → 95 assertions, 0 failures.**

### The architecture, and what it deliberately is not

The corpus answers by default. The network is used under **two** conditions only: a section was
flagged damaged, or the user explicitly asked to verify one. There is no fetch on a normal query,
for four reasons that are worth keeping written down:

1. **There is no API.** flsenate.gov serves HTML per section. Every "Florida Statutes API" on the
   market is scraping that same page and reselling it — they are middlemen, not the source.
2. **Latency.** A round trip to Tallahassee is 300–800ms added to every answer, for no benefit on
   the 99% of sections already correct in the bundle. Twenty questions would be fifteen seconds of
   dead time.
3. **Abuse.** Twenty questions is twenty requests; finals week is hundreds. A desktop app
   hammering a government endpoint is how IPs get blocked.
4. **Fragility.** The site's markup changes between editions. The bundle only changes when we
   change it.

```
query → local corpus (fast, offline)
          └─ integrity flagged damaged?
               ├─ yes → fetch, parse, write overlay, serve repaired   (once)
               └─ no  → serve from the bundle                         (always)
```

### What shipped

| File | What it does |
|---|---|
| `jsons/offline/statute-verifier.js` | `fetchLiveSection`, `parseSectionFromHtml`, `toMarkdown`, `compareSections`, politeness budget. |
| `jsons/offline/corpus.js` | Overlay layer: `setOverlayRoot`, `hasOverlay`, `writeOverlay`, `overlayStatus`, `clearOverlay`. `readSection` now prefers the overlay and returns `provenance`. |
| `jsons/data/offline/shared/authority.json` | The authority line, as data so eight agents cannot drift on it. |
| `jsons/main.js` | `corpus:verify-section`, `corpus:repair-section`, `corpus:overlay-status`, `corpus:revert-section`. |
| `jsons/preload.js`, `src/types/seniorPartner.d.ts` | The four methods, typed. |
| `tools/test_corpus_verify.js`, `tools/fixtures/flsenate-732.102.html` | 29 assertions. |

**Overlay location:** `app.getPath('userData')/corpus-overlay/`, overridable with
`SLP_CORPUS_OVERLAY`. It is app state, not user documents — deleting the directory reverts the app
to the bundle with no other change, and the suite asserts exactly that.

### Two decisions that are load-bearing

**Only what the main process itself fetched is ever written.** `corpus:repair-section` writes from
an in-process cache of the last verify, not from whatever the renderer sends back. The overlay is
served *instead of* the bundle, so a wrong repair would be worse than the damaged original —
nothing downstream would suspect it. The renderer is not trusted with statute text.

**The parser refuses to guess.** Every field is validated, and a page that does not look like a
statute section throws `parse_failed` rather than producing a plausible-looking file. Four guard
assertions cover it: non-statute page, empty body, right shape but wrong section, and too-short
body. The class names targeted (`SectionNumber`, `CatchlineText`, `HISTORY`, `NOTES`) are not
guesswork — they are what the Legislature's own `.nxt` export uses, styled by the same
`FSSection.css` the website references.

**Caveat, stated plainly:** the parser is tested against a **fixture**, not against the live site,
because this work was done without network access. The guards mean a drifted structure fails loudly
instead of writing a bad repair, but **the first live verification still has to be eyeballed** —
verify one section, read the diff, and confirm the body is the statute and not page chrome.

### Politeness

2s minimum spacing, 30/minute ceiling, honest `User-Agent` naming the app, 10s timeout, and
**bounded** exponential backoff on 429 — 1s, 2s, 4s, then stop after 3 retries rather than knocking
forever. Retries happen on 429 only; a 404 or 500 is an answer, and knocking again will not change
it. The suite asserts the configured budget, proves two real requests are ≥2s apart, and covers both
the recover-then-succeed and the give-up path.

### The authority line

Every citation now carries one, and it is honest about which is which:

- verified → `Verified against flsenate.gov on 2026-09-27.`
- otherwise → `From bundled corpus (2026 snapshot) — not verified against live source.`

It is appended, not substituted, so the existing `Source: … (bundled offline corpus) — <file>` line
still says which file the text came from. The Wills and Torts suites pass unchanged.

### Offline behaviour

A DNS failure is classified as `offline`, not as an error. `corpus:verify-section` returns
`{ ok: false, error: 'offline', offline: true }`, the bundled copy still answers, and it carries its
existing integrity warning plus the unverified label. The suite asserts the whole fallback path,
including that reverting a repaired section restores the bundled copy and the unverified label.

### What remains

1. **The UI affordance** — the "Verify against flsenate.gov" banner on a statute card when
   `integrity.ok === false`, and a **Corpus health** panel in Settings driven by
   `corpusOverlayStatus()`. The IPC and types are in place; the offline chat surface it hangs off is
   itself still pending.
2. **A batched "verify all damaged sections"** action. The rate limiter already enforces the
   ceiling, so this is a loop plus progress reporting — but it needs the UI, and it should stay
   opt-in.
3. **Agents 3–8** as before.

