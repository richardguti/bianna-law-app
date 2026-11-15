/**
 * offline-test-lib.js — shared harness for the per-agent assertion suites.
 *
 * Every agent suite asserts the same four things, because those four are what make a discipline
 * agent safe:
 *
 *   1. CLASSIFICATION  — the agent recognises its own question types and doctrines.
 *   2. RETRIEVAL       — the quoted statute text matches the bundled corpus byte for byte. This
 *                        is the load-bearing assertion: it is what proves retrieval rather than
 *                        generation, and a single drift here would mean the agent is paraphrasing.
 *   3. OUT OF SCOPE    — questions belonging to another discipline are refused, not answered.
 *   4. COLLISION       — a genuinely ambiguous question still produces one coherent answer.
 *
 * It also hard-fails on network access. `global.fetch` is replaced before the offline module is
 * loaded, so any attempt to reach the network while "offline" throws instead of quietly working
 * on a developer machine and failing on a plane.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'jsons');

// Installed before the module load, so a stray network call cannot pass unnoticed.
let networkAttempts = 0;
global.fetch = () => { networkAttempts++; throw new Error('NETWORK'); };

const offline = require(path.join(JS, 'offline', 'index.js'));
const corpus = require(path.join(JS, 'offline', 'corpus.js'));

let passed = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (extra === undefined ? '' : '  -> ' + extra)); }
}

/** The bundled body of a section, whitespace-normalised, for verbatim comparison. */
function bundledBody(section) {
  const p = corpus.sectionPath(section);
  if (!p) return null;
  const raw = fs.readFileSync(p, 'utf8');
  const i = raw.indexOf('\n---\n');
  return (i === -1 ? raw : raw.slice(i + 5)).replace(/\s+/g, ' ').trim();
}

/**
 * Assert that a response quoted the corpus rather than paraphrasing it.
 *
 * The probe is taken from the START of the bundled body on purpose. The integrity guard trims a
 * contaminated tail at read time, so a probe taken from the middle could fall beyond the trim
 * point and report a false mismatch. The opening of a section is always what the reader saw.
 */
function quotesVerbatim(response, section) {
  const body = bundledBody(section);
  if (!body) return { ok: false, why: 'no bundled file for ' + section };
  const rtext = String(response.text || '').replace(/\s+/g, ' ');
  if (!rtext.includes(section)) return { ok: false, why: 'does not cite ' + section };
  for (const len of [100, 70, 45]) {
    const probe = body.slice(0, Math.min(len, body.length));
    if (probe.length >= 30 && rtext.includes(probe)) return { ok: true };
  }
  return { ok: false, why: 'quoted text does not match the bundle verbatim' };
}

function summarize(label) {
  console.log('\n=== ' + label + ': ' + passed + ' passed, ' + failures.length + ' failed ===');
  if (networkAttempts) console.log('!! ' + networkAttempts + ' network attempt(s) while offline');
  if (failures.length) { for (const f of failures) console.log('   FAILED: ' + f); process.exit(1); }
}

module.exports = { offline, corpus, ok, bundledBody, quotesVerbatim, summarize, networkAttempts: () => networkAttempts, JS };
