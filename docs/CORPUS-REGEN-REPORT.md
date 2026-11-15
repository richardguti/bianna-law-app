# Corpus Regeneration Report — Phase 0

**Status: BLOCKED at the Phase 0 gate. Do not start Phase 1.**
**Date:** 2026-09-25
**Source:** `Bianna-Law-Final/FLDL-/2026DL/fs2026.nxt` (242,008,064 bytes)
**Extractor:** `tools/extract-nxt.js`
**Live corpus:** `jsons/references/florida-statutes/` — **UNTOUCHED.** All output went to a
scratch directory. Nothing was overwritten and the app still boots from the existing corpus.

---

## Why Phase 0 was attempted first

The plan makes corpus regeneration a precondition: 34.88% of the bundled corpus (8,605 of
24,668 files) carries a fragment of the adjacent section appended to its body. Building seven
new agents on that foundation would embed a known defect eight times over. The gate is
explicit:

> § 732.601 extracts with all four subsections, correct History (`s. 34, ch. 75-220`), correct
> Note (`Created from former s. 736.05`).
> Diff report: **omission rate below 1%.** If it's above 5%, stop — the extraction is wrong and
> the report tells us where.

**Measured omission/defect rate on the gate chapter: 13.3%.** The gate fails. This document is
the "tells us where" part.

---

## What the container actually is

`fs2026.nxt` is not a text file. Its own header identifies it:

```
Copyright (c) 1991-2024, Rocket Software, Inc.  All Rights Reserved. Infobase
```

It is a Rocket **Infobase** (U2) record store. Establishing this was necessary and it is the
single most useful result of the phase.

**Record delimiter.** Every record is preceded by the 19-byte marker:

```
\x11 \x06 \x0B \x04 \x00 L P D D \x00 \x00 \x00 \x00 \x00 \x13 7 \xEF
```

and every record begins with `<!DOCTYPE html>` **exactly 13 bytes** after the `LPDD` bytes.
Verified on 25 consecutive markers. Therefore `DOCTYPE -> DOCTYPE` is an exact record boundary:

```
records in fs2026.nxt: 26,383
```

**Framing bytes.** Infobase interleaves its own framing into the stored value, always adjacent
to markup and (as far as observed) never inside prose:

```
<title>F.S. 102.071\x137\x08</title>              trailing framing after the content
<span class="SectionNumber">\x08102.071\x15...    leading framing before the content
```

The framing carries a **printable** digit and sometimes a printable trailing character, so it
cannot be removed by dropping control bytes alone — that turns `F.S. 102.071` into
`F.S. 102.0717`. This is the trap that the original scraper fell into; see "Where the original
scrape went wrong" below.

**No structural metadata.** Records carry `<title>`, `<span class="SectionNumber">`,
`<CATCHLINE>`, `<SECBODY>`, `<HISTORY>`, `<NOTES>`. There is **no** `ChapterNumber`,
`ChapterTitle`, `TitleNumber` or `PartTitle` element anywhere. The `Title → Chapter → Part`
lines in the existing corpus cannot be regenerated from this source; they must be carried
forward from the existing files or sourced separately.

### Where the original scrape went wrong

Two defects compounded, and they explain both the 34.88% splice rate and the missing
subsections recorded in `docs/CORPUS-DEFECTS.md`:

1. **Segmentation by adjacency.** The container does not store records in document order.
   In one 120 KB window the event order is crossed:

   ```
   DOCTYPE(732.102)  DOCTYPE(732.101)  </body>(732.101)  </body>(732.102)
   ```

   A scraper that assumed "the next record in the file is the next section" attaches the
   neighbouring section's tail to the section before it. That is precisely the 34.88% defect.

2. **Framing bytes read as content.** The framing digit is printable, so the lost content is
   not only appended neighbours but also corrupted boundaries.

The good news, and it is important: **the lost content is present in the source.** A window at
ASCII offset 13,886,514 contains the text the bundled corpus is missing from § 732.601:

- missing tail of (3): `...proportion that one bears to the number of joint ten...`
- missing subsection (4): `...policy of life or accident insurance have died...`

So regeneration is the right repair, not re-scraping.

---

## Extractor implemented

`tools/extract-nxt.js` — segments on `DOCTYPE -> DOCTYPE`, identifies each record by its **own
embedded `<title>`** (never by position), and asserts per record:

| # | Assertion | Rejects |
|---|---|---|
| 1 | `<title>` and `<span class="SectionNumber">` agree | misidentified record |
| 2 | body is present and at least 40 characters | stub / empty record |
| 3 | no control byte or unexpected character survived cleaning | framing leak |
| 4 | body contains no foreign `F.S. <other>` marker | neighbouring-section splice |
| 5 | body contains no markup or catchline remnant | neighbouring-section splice |

Assertion 5 was added during this phase and it works: it now **rejects § 732.601 instead of
shipping it contaminated.**

---

## Measurements — chapter 732 (Wills), the gate chapter

| Metric | Value |
|---|---|
| Records in container | 26,383 |
| Existing corpus files for ch. 732 | 90 |
| Sections attempted | 92 |
| **Extracted clean** | **78 (86.7%)** |
| **Rejected by assertions** | **14 (13.3%)** |
| Records holding >1 section | 2,713 of 26,383 |

Coverage for the gate chapter went from **36/90** on the first attempt to **78/90** once records
were bounded by `DOCTYPE` rather than `</body></html>`.

### § 732.102 — extracted, but not corpus-grade

```
# Fla. Stat. § 732.102 — Spouse's share of intestate estate.

**Section:** 732.102
**Source:** 2026 Florida Statutes (FLLawDL2026)
```

Encoding is **correct**: a real `U+2014` em dash and a real `U+00A7` section mark, with no
mojibake. (The existing corpus carries `â€”` in these positions — regeneration also fixes that.)
But the body still contains framing residue; see the residue audit below.

### § 732.601 — REJECTED, and that is the gate failing

In the run *before* the splice guard was added, § 732.601 extracted with subsections (1), (2)
and (3) — including the tail of (3) that the bundled corpus is missing — **and then ran
straight into the next section**:

```
...the property so held shall be distributed one-half as if one had survived... If there are
more than two joint tenants and all of them so died, the jjss="CatchlineText">0Rules of
construction and intention.0—(6(1) =The intention of the testator as expressed in the will...
```

and it carried the wrong History. With assertion 5 active the file is refused outright.
**The plan's stated gate — § 732.601 extracting correctly — does not pass.**

### Residue audit of the 78 files that passed

| Defect | Files | Share |
|---|---|---|
| Framing leak (` =` where `<span class="Number">` ended) | 47 / 78 | 60% |
| Framing leak (`.:(`) | 37 / 78 | 47% |
| Literal `LPDD` marker in text | 18 / 78 | 23% |
| Leftover `</` markup | 4 / 78 | 5% |

**60% of the files that passed the assertions still carry framing residue.** They passed
because the assertions test for *splices*, not for every possible framing artefact. A corpus
that is 60% residue-contaminated is not an improvement on the corpus it replaces, and shipping
it to the offline agents would trade a known defect for an unknown one.

---

## The three unresolved defect classes

**(a) Head-dropped continuations — 7 sections in ch. 732** (`732.111`, `732.217`, `732.505`,
`732.512`, `732.517`, `732.605`, `732.608`; reported as `body too short (23–38)`).

The section's record is a head-only stub. § 732.505 is **399 bytes**: DOCTYPE,
`<title>F.S. 732.505</title>`, stylesheet links, then the record ends — no `<SECBODY>`, no
`</body>`. The body is in a different record, and no record carries a second
`<title>F.S. 732.505</title>` (duplicate count for ch. 732 is **0**). Locating the continuation
requires one more probe into the records immediately before and after the stub.
**This class is not yet understood at all.**

**(b) Multi-section records with bleed — 7 sections in ch. 732** (`732.2045`, `732.2055`,
`732.2095`, `732.301`, `732.4017`, `732.6005`, `732.601`, `732.608`; reported as `body still
contains markup or a catchline remnant`).

2,713 records hold more than one `<SECBODY>`, and a head-dropped continuation has a
`<CATCHLINE>` but no `<SectionNumber>`. The current slice bounds on the next `<SectionNumber>`,
next `<CATCHLINE>` and the next `</body></html>`, and that is evidently still not the right
boundary set — the next section's catchline is reached before any of them.

**(c) Printable framing residue — 60% of passing files.**

The residue after a control run is not always a digit. Observed tails: `\x137=`, `\x137:`,
`\x137P`, `\x137ï`, `\x137!`, and the fully literal `LPDD` marker. Cleaning a flattened string
is the wrong layer. The fix is to **build the body from the known containers** — read `(n)` out
of `<span class="Number">` and text out of `<span class="Text ...">` — so residue living in the
discarded spans never enters the text at all.

---

## Verdict

**Phase 0 does not pass its gate. Phase 1 and Phase 2 must not start.**

- § 732.601 does not extract correctly. The gate names it explicitly. It fails.
- The defect rate on the gate chapter is **13.3%**, against a 5% stop threshold.
- Even 13.3% understates it: **60% of the sections that passed carry residue**, so the true
  pass rate is far below 86.7%.

Nothing was written to the live corpus and no agent was built on unverified text.

### What is now known and reusable

1. The container is a Rocket Infobase; `LPDD` + 13 bytes precedes every `DOCTYPE`; records are
   `DOCTYPE -> DOCTYPE`. **26,383 records.** Segmentation by adjacency is the original bug.
2. Framing bytes sit adjacent to markup and carry printable characters, which is why control
   stripping is insufficient.
3. Records can hold multiple sections and can be head-only stubs.
4. The lost statute text **is** in the source and is recoverable.
5. Regenerated files are correctly encoded, unlike the existing corpus's mojibake.
6. `Title → Chapter → Part` cannot come from this source and must be carried forward.

### Ordered next steps for the next cycle

1. **Rebuild the body extractor around containers, not flattened text** (fixes class (c), the
   60%) — highest value, most contained.
2. **Probe the stub records' neighbours** to find where continuations are stored (class (a)).
   Until this is answered, no coverage figure can be trusted.
3. **Re-run the ch. 732 gate** and require § 732.601 and § 732.102 clean.
4. Then build `tools/diff-corpus.js` and measure the whole-corpus omission rate, per section,
   against the existing corpus.
5. Only then re-enter the plan at Phase 1.

Realistic effort: **2–3 more days**, not the 3–5 the plan allowed, because the container
forensics are now done and only (a) and (c) remain.
