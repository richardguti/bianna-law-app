/**
 * tools/probe-pdf.js — identify a PDF before writing an extractor for it.
 *
 * Every parser in this repo was written only after looking at the real document. This prints the
 * first page, guesses the document's identity from its own text, and lists the heading-like lines
 * so a new format can be judged in one command instead of by trial and error.
 *
 *   node tools/probe-pdf.js <file.pdf> [headingsRegex] [maxLines]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const FILE = process.argv[2];
const HEADING = process.argv[3] || '^(Rule|§|TITLE|Title|PART|Part|Chapter|Subchapter|ARTICLE)\\b';
const MAX = Number(process.argv[4] || 40);

if (!FILE) { console.error('usage: node tools/probe-pdf.js <file.pdf> [headingRegex] [maxLines]'); process.exit(2); }

(async () => {
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(FILE)) });
  const res = await parser.getText();
  const text = res.text || '';
  const lines = text.split('\n');

  console.log('file   : ' + path.basename(FILE));
  console.log('pages  : ' + (res.total || '?') + '   chars: ' + text.length + '   lines: ' + lines.length);

  console.log('\n=== first 900 chars (identifies the document) ===');
  console.log(JSON.stringify(text.slice(0, 900)));

  const re = new RegExp(HEADING, 'i');
  const hits = [];
  lines.forEach((l, i) => { const t = l.trim(); if (re.test(t)) hits.push([i, t.slice(0, 110)]); });
  console.log('\n=== heading-like lines (' + hits.length + '), first ' + MAX + ' ===');
  for (const [i, t] of hits.slice(0, MAX)) console.log('  L' + i + '  ' + t);
  if (hits.length > MAX) console.log('  ... and ' + (hits.length - MAX) + ' more');
})();
