/**
 * tag_domains.js — stamp every corpus chunk with the practice domain it belongs to.
 *
 * Run after building the corpus, and after any edit to the classifier. Re-tagging is cheap and
 * does not re-extract a single PDF, which is the point: the classification is a derived field, so
 * changing the rules costs seconds rather than the twelve minutes the extraction took.
 *
 * Usage: node tools/tag_domains.js [--dry]
 */

'use strict'

const fs = require('fs')
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(PROJECT_ROOT, 'jsons', 'legal-data')
const { classifyDomain } = require(path.join(PROJECT_ROOT, 'jsons', 'domain-classifier.js'))

const DRY = process.argv.includes('--dry')

function tagFile(fileName) {
  const full = path.join(DATA_DIR, fileName)
  if (!fs.existsSync(full)) return null

  const parsed = JSON.parse(fs.readFileSync(full, 'utf8'))
  const chunks = Array.isArray(parsed.chunks) ? parsed.chunks : []
  const counts = {}

  for (const chunk of chunks) {
    const haystack = `${chunk.source || ''} ${chunk.title || ''} ${String(chunk.content || '').slice(0, 600)}`
    const { domain } = classifyDomain(haystack)
    chunk.domain = domain
    counts[domain] = (counts[domain] || 0) + 1
  }

  parsed.domains = counts
  if (!DRY) fs.writeFileSync(full, JSON.stringify(parsed))

  return { fileName, chunks: chunks.length, counts }
}

const results = ['legal-data.json', 'doctrines.json'].map(tagFile).filter(Boolean)

for (const result of results) {
  console.log(`${result.fileName}: ${result.chunks} chunks`)
  for (const [domain, count] of Object.entries(result.counts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(count).padStart(5)}  ${domain}`)
  }
}

if (DRY) console.log('(dry run — nothing written)')
