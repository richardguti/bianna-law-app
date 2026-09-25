# Known content-accuracy issues

Purpose: the app's *content* failure modes, written down. Not lore, not a scratch note.
If a generated packet states something false, it gets an entry here with the packet, the
claim, the truth, and what it would cost a student. This file exists because the
infrastructure was verifiable and the content was not — every CI assertion in this repo
proves the *artifact*, and none of them can catch a fabricated holding.

## Status of the infrastructure vs the content

The pipeline that was broken for this entire arc is fixed: the app builds on macOS, the
framework symlinks are intact (14, asserted), the bundle is ad-hoc signed, the statute
corpus ships (24,670 files, asserted), and the corpus install yields rather than blocking
the first paint. Those are machine-checkable and they are checked on every build.

**Content accuracy is not machine-checked.** The three entries below were found by
spot-checking three generated packets. Three packets is not a sample; treat the error
rate as unknown, bounded only by "an LLM writing doctrinal detail".

## Confirmed errors

### 1. Wills & Trusts, SA1 — real statute, wrong proposition

- **App said:** § 732.601 supports a 120-hour survival rule.
- **Truth:** § 732.601 is a real Florida statute. It does not contain that rule.
- **Failure type:** real citation, wrong proposition. The most dangerous class, because
  "does this cite exist" checks pass.
- **Cost:** an exam answer citing the wrong statute for a survival requirement.
- **Catchable by:** statute-corpus verification (see below). The statute text is already
  inside the app.

### 2. Criminal Procedure, *Heien v. North Carolina* — real case, wrong posture

- **App said:** labelled Kagan's concurrence "the dissent."
- **Truth:** Kagan wrote a concurrence, joined by Ginsburg, and it is the opinion that
  limits the holding to "exceedingly rare" cases of genuinely ambiguous law. Sotomayor
  dissented alone. The reasoning the app attributed to "the dissent" is closer to
  Sotomayor's.
- **Failure type:** wrong vote and wrong posture on a real case.
- **Cost:** an exam question asking what the dissent said in *Heien* gets the wrong
  justice and the wrong argument.
- **Catchable by:** case-metadata verification (see below). Needs a case index; the
  statute corpus does not contain it.

### 3. Criminal Procedure, *J.L.* — paraphrase presented as a direct quotation

- **App said:** "The Fourth Amendment is not a firearm exception" — in quotation marks.
- **Truth:** that is not the Court's phrasing. Ginsburg's majority did reject the
  argument that *Terry*'s reliability requirement should yield to a categorical gun-tip
  exception, and that underlying point is correctly stated. The wrapper is fabricated.
- **Failure type:** fabricated direct quote around a sound paraphrase. Presented as
  authority, it is fabricated authority.
- **Cost:** an exam answer quoting a line that does not appear in the opinion.
- **Catchable by:** case-metadata verification, plus a quotation-specific check: any
  quoted string attributed to a case should be confirmed verbatim in the source text,
  and degraded to a paraphrase (no quotation marks) if it cannot be.

## The pattern

These are not typos and they are not random. They cluster where doctrine is
high-frequency and detail-rich, and every one of them survives a superficial read. That
is the property that makes them costly: a student without the corpus open cannot tell
the fabricated quote from the real one, and both read equally confident.

## Verification layer, planned

**Phase 1 — statute claims (highest value, lowest cost).** The corpus is already bundled.

1. Extract statute cites from the generated output (`§ \d+\.\d+` and title forms).
2. Read the actual statute text from the corpus.
3. Ask a model whether the cited statute *supports the proposition attached to it* —
   not whether the number exists.
4. Flag mismatches inline, in the output, where the student will see them.

That closes error class 1 outright.

**Phase 2 — case claims.** Case postures, vote counts and quotations are not in the
statute corpus; this needs a case-metadata index (holdings, opinion attributions,
verbatim text). Same shape: extract the cite, look it up, check the claim. Quotation
checks must be verbatim-match or the quotes come off.

Neither is a rebuild. Both are additions.

## Standing disclaimer for generated content

Until Phase 1 ships, anything the app generates carries this:

> AI-generated study aid, not an authority. Verify anything you would write into an exam
> answer against your casebook or the statute itself.

## Adding an entry

One heading per error, with: the packet, what the app said, what is true, the failure
type, what it would cost, and which verification phase would catch it. Say what is
verified and what is not; do not soften an entry to make the app look better. The point
of this file is that the next person does not have to rediscover it.
