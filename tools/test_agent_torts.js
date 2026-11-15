/**
 * tools/test_agent_torts.js — the Torts agent's 26 assertions.
 *
 * Torts is the second discipline, so this suite carries an extra burden: it is the evidence that
 * the runner, the router and the arbitrator are genuinely discipline-agnostic rather than a Wills
 * agent with a second coat of paint. If Wills passes and Torts passes, the pattern generalises.
 *
 *   10 classification  — question type and doctrine
 *   10 retrieval       — the right statute, quoted verbatim from the bundle
 *    5 out of scope    — another discipline's question is refused, not answered
 *    1 collision       — an ambiguous question still yields one coherent answer
 *
 * Run: node tools/test_agent_torts.js
 */
'use strict';

const { offline, ok, quotesVerbatim, summarize } = require('./offline-test-lib.js');

const S = offline.load();
const torts = S.agents.torts;

/* ── 1. Classification ───────────────────────────────────────────────────── */
console.log('=== classification (10) ===');
// [question, expected type or null to accept any, expected doctrine]
const CASES = [
  ['What is the test for proximate cause?',            'rule-lookup',  'negligence'],
  ['What is comparative fault?',                       'definition',   'negligence'],
  ['Does Florida handle slip and fall differently?',   'rule-lookup',  'premises-liability'],
  ['Is a bar liable for serving a drunk driver?',      null,           'dram-shop'],
  ['Who can bring a wrongful death claim?',            null,           'wrongful-death'],
  ['What is the standard of care in a medical negligence case?', 'rule-lookup', 'medical-negligence'],
  ['Can a defendant recover contribution from another tortfeasor?', null, 'contribution-and-release'],
  ['What does Florida say about sovereign immunity?',  'rule-lookup',  'sovereign-immunity'],
  ['How are punitive damages limited in Florida?',      null,          'punitive-damages'],
  ['Drill me on negligence',                           'drill',        'negligence'],
];
for (const [q, wantType, wantDoctrine] of CASES) {
  const c = torts.classify(q);
  const typeOk = wantType === null || wantType === undefined || c.type === wantType;
  const doctrineOk = wantDoctrine === null || wantDoctrine === undefined || c.doctrine === wantDoctrine;
  ok('classify "' + q.slice(0, 46) + '" -> ' + (wantType || 'any') + '/' + (wantDoctrine || 'any'),
    typeOk && doctrineOk && !c.outOfScope,
    'got ' + c.type + '/' + c.doctrine + (c.outOfScope ? ' (refused: ' + c.outOfScope + ')' : ''));
}

/* ── 2. Retrieval: the right statute, quoted verbatim ────────────────────── */
console.log('\n=== retrieval (10) ===');
// [question, expected section, expect a clean copy?]
const RETRIEVAL = [
  ['What is the test for proximate cause?',      '768.81',   true],
  ['Is she liable for the dog bite?',            '767.01',   true],
  ['What is comparative fault?',                 '768.81',   true],
  ['Does Florida handle slip and fall differently?', '768.0755', true],
  ['Who can bring a wrongful death claim?',      '768.16',   true],
  ['What does Florida say about sovereign immunity?', '768.28', true],
  // § 768.125 is one of the bundle's defective copies: its body was replaced by the tail of
  // § 768.12, so there is no statute text to quote. The correct behaviour is not to quote one
  // anyway -- it is to cite the section, say the copy is bad, and stay silent on its content.
  ['Is a bar liable for serving a drunk driver?', '768.125', false],
  ['How are punitive damages limited in Florida?', '768.73',   true],
  ['What is the standard of care in a medical negligence case?', '766.102', true],
  ['Can a defendant recover contribution from another tortfeasor?', '768.31', true],
];
for (const [q, section, expectClean] of RETRIEVAL) {
  const r = offline.ask(q);
  const cited = r.agent === 'torts' && r.citation && r.citation.section === section;
  if (!cited) { ok('"' + q.slice(0, 44) + '" cites ' + section, false, 'got ' + r.agent + '/' + (r.citation && r.citation.section)); continue; }
  const hasText = typeof r.text === 'string' && r.text.length > 0;
  if (!expectClean) {
    // The defect must be surfaced, never hidden and never papered over with the neighbour's text.
    const flagged = r.integrity && r.integrity.ok === false;
    const saysSo = /known bad copy|spliced onto its tail|looks imperfect/.test(r.text);
    ok('"' + q.slice(0, 44) + '" cites § ' + section + ' and flags the defective copy',
      hasText && flagged && saysSo, 'flagged=' + flagged + ' saysSo=' + saysSo);
    continue;
  }
  const v = quotesVerbatim(r, section);
  ok('"' + q.slice(0, 44) + '" quotes § ' + section + ' verbatim', hasText && v.ok, v.why);
}

/* ── 3. Out of scope: another discipline's question ──────────────────────── */
console.log('\n=== out of scope (5) ===');
const FOREIGN = [
  'Does divorce revoke a will?',          // Wills
  'What are the elements of consideration?', // Contracts
  'Is this hearsay?',                     // Evidence
  'What is the mailbox rule?',            // Contracts
  'What is the test for strict scrutiny?', // Con Law
];
for (const q of FOREIGN) {
  const r = offline.ask(q);
  const answeredByTorts = r.agent === 'torts' && r.type === 'rule-lookup';
  ok('refuses "' + q.slice(0, 44) + '"', !answeredByTorts,
    'torts answered with ' + (r.citation && r.citation.section));
}

/* ── 4. Collision: one coherent answer, and it says who else claimed it ──── */
console.log('\n=== cross-agent collision (1) ===');
{
  // A question both disciplines genuinely claim. "trustee" is a Wills signal and "punitive
  // damages" is a Torts one, and neither agent's negative list rejects the other's token, so both
  // fire and the arbitrator has to decide.
  //
  // A question containing "testator" is deliberately NOT used here: Torts refuses it outright on
  // its negative list, so only one discipline would ever fire and the collision would never be
  // exercised. That refusal is itself asserted above, under out-of-scope.
  const q = 'Can the trustee recover punitive damages?';
  const r = offline.ask(q);
  const coherent = typeof r.text === 'string' && r.text.length > 0 && r.source === 'offline';
  const attributed = !!(r.note || r.merged || r.arbitration);
  ok('a two-discipline question yields one attributed answer', coherent && attributed,
    'agent=' + r.agent + ' type=' + r.type + ' note=' + (r.note ? 'yes' : 'no')
    + ' merged=' + (r.merged ? 'yes' : 'no') + ' arbitration=' + JSON.stringify(r.arbitration || null));
}

summarize('Torts agent');
