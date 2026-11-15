/**
 * tools/build-federal-rules.js — the chain, so sequencing is structural rather than habitual.
 *
 * Reading a file another process is still writing produces a plausible, wrong answer. That happened
 * here: two commands ran in parallel and one read a corpus file mid-rewrite, reporting a leak that
 * had already been fixed. So extract -> verify -> test are chained in one process, run one stage at
 * a time, and stop on the first failure. Do not run the stages by hand in parallel.
 *
 *   node tools/build-federal-rules.js
 */
'use strict';

const path = require('path');
const cp = require('child_process');

const EDITION = '2024-12-01';
const SOURCES = path.join(__dirname, 'sources', 'federal-rules');
const REF = path.join(__dirname, '..', 'jsons', 'references');

const SETS = [
  ['federal-rules-of-evidence-dec-1-2024_0.pdf', 'federal-rules-of-evidence', 'Federal Rules of Evidence', 'Fed. R. Evid.'],
  ['federal-rules-of-civil-procedure-dec-1-2024_0.pdf', 'federal-rules-of-civil-procedure', 'Federal Rules of Civil Procedure', 'Fed. R. Civ. P.'],
  ['federal-rules-of-criminal-procedure-dec-1-2024_0.pdf', 'federal-rules-of-criminal-procedure', 'Federal Rules of Criminal Procedure', 'Fed. R. Crim. P.'],
  ['federal-rules-of-appellate-procedure-dec-1-2024_0.pdf', 'federal-rules-of-appellate-procedure', 'Federal Rules of Appellate Procedure', 'Fed. R. App. P.'],
  ['federal-rules-of-bankruptcy-procedure-dec-1-2024_0.pdf', 'federal-rules-of-bankruptcy-procedure', 'Federal Rules of Bankruptcy Procedure', 'Fed. R. Bankr. P.'],
];

function stage(label, args) {
  process.stdout.write('\n########## ' + label + ' ##########\n');
  const r = cp.spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('\nSTOPPED: "' + label + '" failed with exit ' + (r.status || 1) + '. Later stages not run.');
    process.exit(r.status || 1);
  }
}

let n = 0;
for (const [pdf, dir, label, cite] of SETS) {
  stage('EXTRACT ' + dir, [
    path.join(__dirname, 'extract-federal-rules.js'),
    path.join(SOURCES, pdf),
    path.join(REF, dir + '-' + EDITION),
    '--label', label, '--cite', cite,
  ]);
  n++;
}
for (const [pdf, dir] of SETS) {
  stage('VERIFY ' + dir, [
    path.join(__dirname, 'verify-federal-rules.js'),
    path.join(REF, dir + '-' + EDITION),
    path.join(SOURCES, pdf),
  ]);
}
stage('TEST (assertions + positive controls)', [path.join(__dirname, 'test_federal_rules.js')]);

console.log('\nALL STAGES PASSED: ' + n + ' corpora extracted, ' + n + ' verified, assertions and controls green.');
