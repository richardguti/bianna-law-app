# Corpus defects

Defects in the bundled statute corpus (`icm/references/florida-statutes/`), independent
of anything the model generates. This is a different artifact from
`KNOWN-CONTENT-ISSUES.md`: that file records wrong claims the app *wrote*; this file
records wrong source text the app *reads*.

The corpus is treated as ground truth by the verification layer. It is not. Until it is
regenerated, a claim can be verified against damaged text and flagged confidently wrong
in either direction.

## Audit summary (full scan, 2026-09-25)

```
corpus files   : 24,670
flagged        : 843   (3.42%)   95% CI 3.19% - 3.64%
markers        : html-attr-remnant 430, tag-remnant 415, catchline-remnant 23,
                 entity-remnant 1
```

**3.42% is a floor, not the rate.** The scan detects *markup remnants*. It cannot detect
a section truncated cleanly, with no stray markup — and that class demonstrably exists,
because § 732.601 (below) was caught only because the damage was noisy. The true defect
rate is unknown and higher.

Corruption is strongly concentrated, up to ~6x the average:

```
ch 404  21.43%   ch 491  17.86%   ch 1008 17.14%   ch 95  16.67%
ch 493  15.56%   ch 119  15.00%   ch 1011 14.77%   ch 921 13.51%
```

The worst chapters are regulatory code — insurance, education, professional licensing,
credit — dense text with heavy cross-referencing. **They are not curriculum chapters.**
By area of study the corpus is at or below the average exactly where a 1L/2L cites:

```
Evidence                        0/137    0.00%
Wills / Trusts / Estates       11/463    2.38%
Civil Practice & Procedure     21/788    2.66%
Property (real & personal)     22/791    2.78%
Criminal Law (substantive)     27/968    2.79%
Business Organizations         27/955    2.83%
Torts                           6/195    3.08%
Contracts / Sales (UCC 2)      19/582    3.26%
Criminal Procedure             52/1209   4.30%   <- elevated
Family Law                     18/260    6.92%   <- worst
```


## Defect 1 — Fla. Stat. § 732.601 is missing a subsection

**File:** `references/florida-statutes/title-42-estates-and-trusts/732.601.md`

The file at the centre of the Wills & Trusts failure. Mechanically diffed against the
official 2026 text (`flsenate.gov/Laws/Statutes/2026/732.601`), which is character-for-
character identical to the 2025 edition — so this is a scrape defect, not currency.

Missing, verbatim from the official section:

1. The tail of subsection (3):
   > If there are more than two joint tenants and all of them so died, the property thus
   > distributed shall be in the proportion that one bears to the number of joint tenants.
2. The whole of subsection (4):
   > (4) When the insured and the beneficiary in a policy of life or accident insurance
   > have died and there is insufficient evidence that they died otherwise than
   > simultaneously, the proceeds of the policy shall be distributed as if the insured had
   > survived the beneficiary.

Subsection (3) is truncated mid-sentence at `...If there are more than two joint tenants
and all of them so died, the j`.

Metadata is the neighbouring section's, not this one's:

| | official | corpus |
|---|---|---|
| History | `s. 1, ch. 74-106; s. 34, ch. 75-220; s. 966, ch. 97-102; s. 50, ch. 2001-226.` | `s. 1, ch. 74-106; ss. 33, 35, ch. 75-220; s. 965, ch. 97-102; s. 49, ch. 2001-226.` |
| Note | `Created from former s. 736.05.` | `Created from former ss. 732.41 and 732.602.` |

Note the shape of the error: the chapter numbers are right and the section numbers within
them are off (`s. 34` -> `ss. 33, 35`; `s. 966` -> `s. 965`; `s. 50` -> `s. 49`). The
scraper did not corrupt the history — it attached the adjacent section's. Section-boundary
detection is off by one.

The body contains another section spliced in:

```
... If there are more than two joint tenants and all of them so died, the j
jss="CatchlineText">Rules of construction and intention.
—
(1) The intention of the testator as expressed in the will controls the legal effect...
```

A broken HTML attribute (`<... jss="CatchlineText">`) is left mid-body, followed by the
catchline and text of a different section. A regex counting `^(\d)` finds **5**
subsections where the statute has **4** — so a subsection-count check catches this file.

**Impact.** A model reading this corpus does not merely mis-cite: it is missing a real
rule (insurance proceeds where insured and beneficiary die simultaneously) and can
attribute an unrelated section's rule to § 732.601. It can also be told the wrong
legislative history.

**Why the marker scan caught this one but would not catch a clean truncation.** The
splice left `jss="CatchlineText">` behind. Strip that and the file passes every string
check while still missing (3)'s tail and all of (4).

## Defect 2 — no provenance, no scraper

`FLLawDL2026`, named in each file's `Source:` line, is a label with no tool behind it.
Nothing in this repository generates the corpus: the only files referencing it are
`main.js`, `icm.js`, `preload.js` and this doc. `icm/` contains only
`references/florida-statutes/`.

Regeneration is therefore writing a scraper, not re-running one. The upstream is public
and per-section:

```
https://www.flsenate.gov/Laws/Statutes/{year}/{section}      years 1997-2026
Bulk "Download" link present on https://www.leg.state.fl.us/statutes/
```

The corpus's `Source: 2025 Florida Statutes` and `.version = 2025.2-fl26` map to the 2025
edition; 2026 is available, so regeneration also moves the snapshot forward.

## What the rebuild must emit, per file

The structural facts, or none of the checks below can run:

- section number (must match the filename)
- subsection count
- the History line
- the Note line
- the source URL and year

## P-0 gate — assertions for the regenerated corpus

1. **No markup remnants** — no `[a-z]{2,}="[A-Za-z]+">`, no `CatchlineText`, no residual
   tags or entities. Catches the noisy class.
2. **Section number matches the filename.** Catches mis-labelled files.
3. **Subsection count matches the manifest.** The only assertion that catches a missing
   rule, and the one that catches § 732.601: 5 body subsections against a manifest of 4.
4. **History and Note match the manifest** verbatim. Catches adjacent-section metadata,
   which is how defect 1's History and Note are wrong.

Assertions 3 and 4 are structural. String greps cannot see a silently absent clause;
these can.

## Regression fixture

`732.601` is the canonical test. Any regenerated corpus must satisfy: 4 subsections, (3)
ending `...in the proportion that one bears to the number of joint tenants.`, (4) present,
History carrying `s. 34`, `s. 966` and `s. 50`, Note reading `Created from former
s. 736.05.`, and no occurrence of `CatchlineText`.

