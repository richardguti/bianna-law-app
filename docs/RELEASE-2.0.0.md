# Release 2.0.0 — build record

Written 2026-11-14. This documents where the build is, what was verified, what was corrected, and
what is still not trustworthy. It is a record of evidence, not a marketing sheet.

## Artifacts

| What | Path |
|---|---|
| Packaged Windows app | `jsons/dist/win-unpacked/Senior Law Partner.exe` |
| Packed application archive | `jsons/dist/win-unpacked/resources/app.asar` (269.8 MB) |
| Renderer bundle | `jsons/dist-react/` (index.html + 783 KB JS + 56 KB CSS) |
| Doctrine corpus | `jsons/legal-data/doctrines.json` (2,439 chunks, 19 sources) |
| Florida corpus | installed at `%OneDrive%\Documents\Bianna_Law\references\florida-statutes` (24,670 files, version 2025.2-fl26) |

There is **no installer**. `build.win.target` is `dir`, so the deliverable is the unpacked folder.
To make an NSIS installer: `electron-builder --win nsis` (requires network for the NSIS toolchain).

## Verified on the packaged build

Launched from `win-unpacked` with a clean environment (`ELECTRON_RUN_AS_NODE` unset):

- `whenReady fired … packaged=true`, `loadFile resolved`, `renderer MOUNTED (failedLaunches -> 0)`
- `getAppVersion()` â†’ `2.0.0`
- corpus `2,439` chunks; domains `general 1113, torts 478, property 291, constitutional 272, criminal 200, contracts 85`
- news providers `{rss: true, topic: true, oxylabs: false}`; coverage report returns 10 subjects
- `ragSearch({domain:'criminal'})` returns corpus hits
- routes `/dashboard`, `/exam`, `/sources`, `/florida` all render

Verified on the development build (same code, same bundle):

- **25 of 25 routes** render content with no error text
- **17 of 17 IPC channels** respond (version, prefs, rag stats/search, real-world status, corpus
  status, vault, calendar, profile, editable fields, chat days, ICM stats, exam generation)

## Legal accuracy corrections made during this review

1. `Restatement (Second) of Property § 25.1` — **removed**. The section does not exist in the corpus
   and the number could not be verified. Now cites the Restatement title without a pin cite.
2. `Duke of Norfolk's Case; Restatement (Second) of Property § 26.1` — **replaced** with the case
   itself, `3 Ch. Cas. 1, 22 Eng. Rep. 931 (1682)`.
3. `U.C.C. § 2-207; Restatement (Second) of Contracts § 2-207 comment` — **wrong**. The Restatement
   has no § 2-207 (that is UCC numbering). Now `U.C.C. § 2-207 cmt. 3`.
4. EU AI Act transparency obligations were dated `2026-12-01`; **art. 113 applies them from
   2 August 2026**. Corrected.
5. Sources page now states that the worked example's authorities are supplied with the exercise and
   are not drawn from the bundled corpus.

Checked and left alone: `U.C.C. § 2-615`, `Fla. Stat. § 672.615`, `Fla. Stat. § 501.171` (30 days),
`Cal. Civ. Code § 1798.82`, `N.Y. Gen. Bus. Law § 899-aa`, `GDPR art. 33(1)`,
`Restatement (Second) of Contracts §§ 19, 50, 90`, `Restatement (Second) of Torts § 281`,
`U.S. Const. art. II, § 2`, `Regulation (EU) 2024/1689 art. 50`.

## Packaging defects found and fixed

1. **BOM in `package.json`.** Setting the version with a PowerShell `Set-Content` introduced a
   byte-order mark, which `@electron/rebuild` rejects with `Unexpected token '\uFEFF'`. Written back
   as UTF-8 without BOM.
2. **Module allowlist.** `build.files` listed root modules explicitly and predated this work, so
   `realworld.js` and `domain-classifier.js` were **missing from the package** — Real World and all
   domain-scoped retrieval would have failed in the shipped app while working in development. Now
   `*.js`, so a new root module cannot be silently dropped again.
3. **Code signing.** No certificate on this machine; `electron-builder` exits 1 at the signing step.
   The package is complete and runs, but the exe is **unsigned**, so Windows SmartScreen will warn.

## Exam generator: answer-position bias (fixed)

Found by using the build: every correct answer sat in position A, so a student could score 100%
without reading. Three causes, all fixed:

1. **The prompt's JSON example read `"answerIndex":0`** and the model copied the pattern. The
   example now shows `2`, and the instructions require the key to be spread across positions.
2. **Options were never shuffled.** They are now shuffled per question (Fisher“Yates) with the key
   remapped, so the position is independent of the model's habits.
3. **A "balancing" pass made it worse.** It picked the over-represented index with
   `counts.indexOf(max)`, which returns 0 on ties, so position A was re-shuffled more often and two
   consecutive live runs produced *no* correct answer in A. The pass was removed; a single uniform
   shuffle measured 519/517/470/494 over 2,000 simulated questions, and two live 10-question runs
   now distribute 3/2/3/2 and 2/3/2/3.

Also fixed in the same review:

- **Truncated runs.** One request for 8 questions returned 1 — the JSON array hit the output-token
  limit and only the first object survived. Generation now runs in batches of six, so a 10-question
  run returns 10 in about 26 seconds.
- **Rationales leaked the source.** Text like "The materials place restitution in… Option 1 is
  correct" told the student which option was right before they reasoned. Rationales must now be
  legal prose, refer to options by substance, and never mention the passage.

## Exam tracks

Two tracks now share one generator, because the questions are answered by different work.

**Law — Florida Bar.** The sixteen subjects the Florida Board of Bar Examiners publishes test
specifications for are selectable directly, and the prompt requires answering under Florida law
where it diverges from the general law. The Board's own test specifications and study guides are
ingested into a `barprep` shelf, so a run is grounded in what the Board says it tests — including
past essay questions from the study guides.

**Machine learning — qualifying exam.** A `ml` shelf holds *The Elements of Statistical Learning*
and *Probabilistic Machine Learning: Advanced Topics*. The question types are replaced by the four
modalities a candidacy exam uses — derivation, proof, failure-mode diagnosis, and complexity — and
the prompt demands notation, stated assumptions and a worked solution rather than a selected option.

Corpus after this change: **2,947 chunks** — `general 1113, torts 478, barprep 480, property 291,
constitutional 272, criminal 172, contracts 85, ml 56`.

### Limits of the tracks

- **`ml` is 56 passages, not two books.** Sampling caps a file at 28 chunks, so ESL and Murphy each
  contribute 28 excerpts. Coverage of a 40 MB textbook is a sample, and a question may rest on a
  passage that is unusually specific.
- **`barprep` is 480 chunks** across 33 files — the specifications are short and well covered; the
  88 MB family-law volume and the 6 MB probate volume are sampled.
- **This is not a timed simulator.** It reproduces the Board's subject list, sources and answering
  convention; it does not reproduce the session structure (Part A: three hours of essays plus three
  hours of 100 multiple-choice), the scaling to 136, or adaptive Bluebook-style practice.
- ML written answers are self-graded against a worked solution, like the law essays.

## Known limits — do not launch claiming otherwise

- **Retrieval is lexical.** BM25 plus coverage heuristics, no embeddings. "Slayer statute" will not
  find wills material; some valid queries return "not in corpus".
- **Real World correlation is conservative and sometimes wrong in the other direction.** It now
  refuses rather than returning adjacent law, but a headline can still match a passage that shares
  vocabulary without being the governing rule.
- **Exam questions are model-written from retrieved passages.** Grounding constrains the subject;
  it does not guarantee every distractor is defensibly wrong. Essay and written answers are
  self-graded against a rubric.
- **Demonstration fixtures are not corpus-backed.** The scenario authorities (`Transatlantic`,
  `Lloyd v. Murphy`, `Eastern Air Lines`) are supplied with the exercise.
- **The Oxylabs news provider is untested** — no credentials. Code follows the vendor's API contract.
- **Criminal procedure is thin**: 200 chunks, 28 of them from the added textbook (sampled, not the
  whole book).

## Rebuild

```powershell
cd 'F:\Bianna - Law\Bianna-Law-Final'
# corpus (only when sources change); DOCTRINE_EXTRA takes extra books, semicolon-separated
$env:DOCTRINE_EXTRA='F:\Bianna - Law\Criminal Procedure_ ....pdf'
node tools\build_doctrine_corpus.js --max-minutes 30

& '.\jsons\node_modules\.bin\vite.cmd' build --config jsons\vite.config.ts
cd jsons
.\node_modules\.bin\electron-builder.cmd --win --dir --config.npmRebuild=false --config.win.signAndEditExecutable=false
```

`--config.win.signAndEditExecutable=false` skips the failing sign step. Launch the packaged app with
`ELECTRON_RUN_AS_NODE` **unset**, or it runs main.js as plain Node and dies on `app.whenReady`.

## Bar-prep coverage audit

Measured against the four pillars a commercial Florida course is built on, not against what the app
happens to do.

| Pillar | Status | Evidence / gap |
|---|---|---|
| FBBE study guides and released essays | **Covered** | 14 guides + *726 Essays* ingested into `barprep`; the July 2026 essay questions are in the shelf |
| FBBE test specifications | **Covered** | All 17 specification documents ingested; the sixteen subjects are selectable |
| FBBE Practice Analysis | **Covered** | Report ingested, and its Table ES 4 weights are encoded as `BAR_BLUEPRINT`, so an unconstrained Bar run follows the survey's subject distribution |
| Florida Statutes and Rules | **Partial** | 24,670 sections installed and browsable on the Florida page, but the exam does **not** yet retrieve from that corpus — items are grounded in `barprep` and `general` |
| NCBE licensed MBE questions | **Missing** | Licensed content; cannot be bundled. Part B items are written from national doctrine instead |
| Part A subjects | **Covered** | 16 subjects selectable |
| Part B (MBE) subjects | **Covered** | 7 Multistate subjects added, grounded in the national shelves rather than the Florida shelf |
| 50/50 A/B split in one run | **Missing** | The candidate chooses Part A or Part B; no run mixes them |
| Florida distinctions | **Partial** | Six distinctions wired into the prompt (Fla. Stat. §§ 768.81, 768.28, 732.201, 732.302, 732.502; Fla. Const. art. X § 4; Fla. R. Crim. P. 3.191; Fla. R. Civ. P. 1.510). Verified reaching items — a Torts run produced items naming sovereign immunity, several liability and § 768 |
| Outlines | **Covered (pre-existing)** | Outline Generator page |
| IRAC essay rubrics | **Partial** | Rubric is generated per essay; grading is self-assessment, not automated IRAC scoring |
| Timed 3-hour simulation | **Missing** | No session timer, no scaled scoring to 136 |
| Sub-topic analytics | **Missing** | Right/wrong totals only; no per-subject breakdown over time |
| Spaced repetition / adaptive scheduling | **Missing** | Not built |

The honest summary: the **content** side now matches a prep course's inputs for Part A, and the
**generation** side is instrumented (level plan, item-quality rules, review pass). The **delivery**
side — timing, scaled scoring, analytics, adaptive review — is the part that is not there.