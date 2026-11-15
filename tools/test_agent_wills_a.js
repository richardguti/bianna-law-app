/**
 * Offline mode test suite.
 *
 * The load-bearing assertion is the verbatim one: for every rule-lookup and definition answer,
 * the quoted statutory text must appear character-for-character in the bundled file. That is
 * what proves the offline agent retrieves rather than generates -- the property that makes it
 * safe on a rule question, and the property no model can offer.
 *
 * The network is poisoned before the module loads, so any attempt to reach out fails loudly.
 */
'use strict';
const fs = require('fs');
const path = require('path');

global.fetch = () => { throw new Error('NETWORK ACCESS ATTEMPTED IN OFFLINE MODE'); };

const J = path.join(__dirname, '..', 'jsons');
const corpus = require(path.join(J, 'offline', 'corpus.js'));
const router = require(path.join(J, 'offline', 'router.js'));
const offline = require(path.join(J, 'offline', 'index.js'));

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  -> ' + detail : '')); }
}
const S = offline.load();

/* ── 1. Doctrine maps must not reference sections that are not bundled ── */
console.log('=== doctrine maps vs the actual corpus ===');
let refs = 0; const missing = [];
for (const [id, d] of Object.entries(S.agents['wills-trusts'].doctrines)) {
  for (const sec of d.statutes || []) {
    refs++;
    if (!corpus.sectionPath(sec)) missing.push(id + ' -> ' + sec);
  }
}
ok('all ' + refs + ' referenced sections exist in the bundle', missing.length === 0, missing.join(', '));
ok('14 doctrines loaded', Object.keys(S.agents['wills-trusts'].doctrines).length === 14);

/* ── 2. The integrity guard ── */
console.log('\n=== corpus integrity guard ===');
const d102 = corpus.readSection('732.102', S.knownDefects);
ok('732.102 splice detected', d102.integrity.anomalies.includes('tail_contaminated'));
ok('732.102 trimmed (no 732.101 text left)',
  !d102.body.includes('Any part of the estate of a decedent not effectively disposed of by will'));
ok('732.102 keeps its own text', d102.body.includes('surviving spouse'));
ok('732.101 is clean', corpus.readSection('732.101').integrity.anomalies.length === 0);
ok('a missing section is reported, not substituted',
  corpus.readSection('999.999').found === false && !!corpus.readSection('999.999').reason);
const d601 = corpus.readSection('732.601', S.knownDefects);
ok('the known-bad 732.601 is flagged', !!d601.integrity.knownDefect && d601.integrity.ok === false);
ok('spliced catchlines are flagged corrupt',
  corpus.catchlineIsCorrupt('CHAPTER 732PART VI RULES OF CONSTRUCTION  732.6005Rules of'));

/* ── 3. Routing, including the negative list ── */
console.log('\n=== router ===');
const route = (t) => router.dispatch(t, S.rt, S.meta).agentIds;
ok('a wills question dispatches', route('What does Florida say about elective share?').includes('wills-trusts'));
ok('an intestacy question dispatches', route('who inherits when there is no will').includes('wills-trusts'));
ok('an explicit citation dispatches', route('what does 732.502 require').includes('wills-trusts'));
ok('a contracts question does NOT dispatch (negative list)',
  route('what are the elements of consideration for a contract').length === 0);
ok('an evidence question does NOT dispatch',
  route('is this hearsay and is it admissible').length === 0);
ok('a greeting does NOT dispatch', route('hello there').length === 0);

/* ── 4. Question typing ── */
console.log('\n=== question typing ===');
const A = S.agents['wills-trusts'];
ok('rule-lookup', offline.questionType(A, 'What does Florida say about elective share?') === 'rule-lookup');
ok('definition', offline.questionType(A, 'Define ademption.') === 'definition');
ok('procedure recognised (and deferred)', offline.questionType(A, 'Steps to probate a will') === 'procedure');
ok('drill recognised (and deferred)', offline.questionType(A, 'drill me on intestacy') === 'drill');

console.log('\n=== part A: ' + pass + ' passed, ' + fail + ' failed ===');
process.exitCode = fail ? 1 : 0;
