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
4. **Corpus regeneration (P-1c)** — the guard makes the current bundle safe; regeneration from
   `fs2026.nxt` makes it unnecessary.
5. **Grow `gloss-rules.json`** toward the top 50 sections. Glosses are hand-authored on purpose:
   a generated gloss would reintroduce the hallucination risk offline mode exists to remove.

