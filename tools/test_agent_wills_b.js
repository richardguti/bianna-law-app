/**
 * Offline mode test suite, part B: the retrieval invariant, total coverage, and response shape.
 * Self-contained, with the network poisoned before the module loads.
 */
'use strict';
const fs = require('fs');
const path = require('path');

global.fetch = () => { throw new Error('NETWORK ACCESS ATTEMPTED IN OFFLINE MODE'); };

const J = path.join(__dirname, '..', 'jsons');
const corpus = require(path.join(J, 'offline', 'corpus.js'));
const offline = require(path.join(J, 'offline', 'index.js'));

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  -> ' + detail : '')); }
}

/* ── THE INVARIANT ───────────────────────────────────────────────────────── */
console.log('=== verbatim invariant: quoted text must exist in the bundle ===');
const QUOTED = [
  'What does Florida say about elective share?',
  'What does Florida say about intestacy?',
  'What does Florida say about homestead?',
  'What does Florida say about the spendthrift provision?',
  'What is homestead?',
  'Define ademption.',
  'What does Fla. Stat. 732.601 say?',
];
const norm = (s) => s.replace(/\s+/g, ' ').trim();
let checked = 0;
for (const q of QUOTED) {
  const r = offline.ask(q);
  if (!r.citation) { ok('quoted: ' + q, r.type === 'reflection', 'no citation and not a reflection'); continue; }
  const raw = norm(fs.readFileSync(corpus.sectionPath(r.citation.section), 'utf8'));
  // Ignore the template's own lines; test only the quoted statutory body.
  const body = r.text.split('\n').filter((l) => l.trim().length > 30
    && !l.startsWith('Fla. Stat.') && !l.startsWith('Source:') && !l.startsWith('Related')
    && !l.startsWith('In plain terms') && !l.startsWith('\u26a0'));
  const found = body.length > 0 && body.some((l) => raw.includes(norm(l)));
  checked++;
  ok('§ ' + r.citation.section + ' verbatim (' + q.slice(0, 30) + ')', found);
}
ok('checked ' + checked + ' cited answers', checked >= 6);

/* ── Coverage: nothing returns null, nothing touches the network ───────── */
console.log('\n=== total coverage, no network ===');
const INPUTS = ['', 'hello', 'what is the mailbox rule?', 'is this admissible?', 'drill me',
  'steps to probate', 'who gets the house', 'define ademption', 'what does florida say about wills',
  '732.502', 'nonsense gibberish zzz', 'can a creditor reach a spendthrift trust?',
  'what happens if the beneficiary dies first', 'does divorce revoke a will'];
let renderable = 0, networked = 0;
for (const q of INPUTS) {
  let r;
  try { r = offline.ask(q); }
  catch (e) { if (/NETWORK/.test(e.message)) { networked++; continue; } throw e; }
  if (r && typeof r.text === 'string' && r.text.length > 0 && r.source === 'offline') renderable++;
}
ok('all ' + INPUTS.length + ' inputs produced renderable text', renderable === INPUTS.length, renderable + '/' + INPUTS.length);
ok('no network attempt', networked === 0);

/* ── Response shape for the UI ───────────────────────────────────────────── */
console.log('\n=== response shape ===');
const rl = offline.ask('What does Florida say about elective share?');
ok('rule-lookup cites the section', !!rl.citation && rl.citation.section === '732.201');
ok('rule-lookup shows attribution', rl.text.includes('bundled offline corpus'));
ok('rule-lookup reports integrity', rl.integrity.ok === true);
const df = offline.ask('What is homestead?');
// 732.227 "Homestead defined." is the right target for a definition question; the earlier
// version of this assertion expected 732.401 "Descent of homestead", which is the section
// about how homestead descends, not what it is. The prefix bonus in rankSections fixed that.
ok('definition cites the defining section', !!df.citation && df.citation.section === '732.227',
  df.citation && df.citation.section);
ok('unknown offline reflects rather than guesses', offline.ask('what is the mailbox rule?').type === 'reflection');
const rf = offline.ask('what is the mailbox rule?');
ok('reflections offer next questions', Array.isArray(rf.suggestions) && rf.suggestions.length > 0);
ok('out-of-scope clarifies', offline.ask('is this hearsay').type === 'clarify');
ok('deferred features say so', offline.ask('steps to probate a will').type === 'unavailable');
ok('every response carries text', [rl, df, rf].every((r) => typeof r.text === 'string' && r.text.length > 0));

/* ── The known-defect path is visible, not silent ────────────────────────── */
console.log('\n=== known bad copy is surfaced ===');
const bad = offline.ask('What does Fla. Stat. 732.601 say?');
ok('flagged as not-ok', bad.integrity && bad.integrity.ok === false);
ok('the answer says why', /known bad copy/i.test(bad.text));

console.log('\n=== part B: ' + pass + ' passed, ' + fail + ' failed ===');
process.exitCode = fail ? 1 : 0;
