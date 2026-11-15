/**
 * researchSources.ts — what this app reads, and what each thing is allowed to be.
 *
 * The distinction the registry enforces is the one that gets lost when "legal AI" is discussed
 * as a single category: a case-law API, a primary-source publisher, a legislative dataset and a
 * benchmark are four different kinds of object. Only two of them can support a statement about
 * what the law is, and a benchmark supports none — it measures whether a model can do the task,
 * which is a claim about the model, not about the law.
 *
 * Every field here is meant to be shown to a user. A caveat that only lives in a README is not
 * a safeguard.
 */

export type SourceKind =
  | 'case-law'
  | 'primary'
  | 'legislative'
  | 'benchmark'
  | 'dataset'
  | 'directory'
  | 'library'

export interface ResearchSource {
  id: string
  name: string
  /** If it can be read over the network, where. Empty for local corpora. */
  url: string
  repo?: string
  kind: SourceKind
  /** What the app is allowed to do with it. */
  role: string
  limitation: string
  jurisdiction: string
  /** Set when the material cannot ship with the app. */
  licenceNote?: string
}

export const RESEARCH_SOURCES: ResearchSource[] = [
  {
    id: 'courtlistener',
    name: 'CourtListener (Free Law Project)',
    url: 'https://www.courtlistener.com',
    repo: 'freelawproject/courtlistener',
    kind: 'case-law',
    role: 'Retrieve judicial opinions and dockets, and read citator signals.',
    limitation:
      'Coverage and currency vary by court and document type. An opinion is not a statute, and a missing opinion is not an absence of law.',
    jurisdiction: 'US federal and state',
  },
  {
    id: 'uscode',
    name: 'U.S. Code — Office of the Law Revision Counsel',
    url: 'https://uscode.house.gov',
    kind: 'primary',
    role: 'Supply the current text of the U.S. Code.',
    limitation:
      'Current only to the last published supplement. Cross-check anything that turns on an amendment in the current session.',
    jurisdiction: 'US federal',
  },
  {
    id: 'ecfr',
    name: 'eCFR',
    url: 'https://www.ecfr.gov',
    kind: 'primary',
    role: 'Supply current Code of Federal Regulations text.',
    limitation:
      'Federal regulation only. Says nothing about state law, and a regulation is not the statute that authorises it.',
    jurisdiction: 'US federal',
  },
  {
    id: 'congress',
    name: 'Congress.gov data (unitedstates/congress)',
    url: 'https://www.congress.gov',
    repo: 'unitedstates/congress',
    kind: 'legislative',
    role: 'Bills, amendments and roll-call votes — legislative history.',
    limitation:
      'Not an authoritative source for the current text of the U.S. Code. A bill that passed is not the section as it now reads.',
    jurisdiction: 'US federal',
  },
  {
    id: 'fl-statutes',
    name: 'Florida Statutes (bundled corpus)',
    url: 'https://www.flsenate.gov/Laws/Statutes',
    repo: 'Vaquill-AI/open-us-law',
    kind: 'primary',
    role:
      'Serve Florida statute sections offline, with the bundle version attached, and diff a section against the Florida Senate on demand.',
    limitation:
      'A snapshot, not a live feed. Scrapers break and snapshots age, so the text is labelled with its version and every section can be checked against flsenate.gov.',
    jurisdiction: 'Florida',
  },
  {
    id: 'fl-court-rules',
    name: 'Florida court rules',
    url: 'https://www.floridabar.org/rules/',
    repo: 'Vaquill-AI/open-us-law',
    kind: 'primary',
    role: 'Procedural rules for Florida courts.',
    limitation:
      'Ingest pipeline exists upstream but is not bundled here yet; the app reports the gap rather than pretending the rules are present.',
    jurisdiction: 'Florida',
  },
  {
    id: 'leviathan',
    name: 'Leviathan-Law doctrine library',
    kind: 'library',
    url: '',
    role: 'Secondary reference shelf: restatements, codes, treatises, notes.',
    limitation:
      'Secondary material. Persuasive context and a way to find the authority — never itself the authority.',
    jurisdiction: 'US',
  },
  {
    id: 'legalbench',
    name: 'LegalBench (HazyResearch)',
    url: 'https://github.com/HazyResearch/LegalBench',
    repo: 'HazyResearch/legalbench',
    kind: 'benchmark',
    role: 'Evaluate whether a model can perform a legal reasoning task.',
    limitation:
      'A benchmark, not a reference library. Scoring well does not establish legal expertise, and a benchmark result is not an authority.',
    jurisdiction: 'US, task-dependent',
  },
  {
    id: 'lexglue',
    name: 'LexGLUE',
    url: 'https://github.com/coastalcph/lex-glue',
    repo: 'coastalcph/lex-glue',
    kind: 'dataset',
    role: 'Legal-language understanding datasets for evaluation.',
    limitation:
      'Covers several jurisdictions and tasks. Check each dataset’s jurisdiction before making any U.S.-law claim from it.',
    jurisdiction: 'Multi-jurisdiction',
  },
  {
    id: 'awesome-legal-data',
    name: 'awesome-legal-data (OpenLegalData)',
    url: 'https://github.com/OpenLegalData/awesome-legal-data',
    repo: 'OpenLegalData/awesome-legal-data',
    kind: 'directory',
    role: 'A place to find corpora and text-processing resources.',
    limitation: 'A catalogue. Nothing in it is vetted for currency or accuracy by being listed.',
    jurisdiction: 'Global',
  },
]

export const KIND_LABEL: Record<SourceKind, string> = {
  'case-law': 'Case law',
  primary: 'Primary',
  legislative: 'Legislative',
  benchmark: 'Benchmark',
  dataset: 'Dataset',
  directory: 'Directory',
  library: 'Library',
}

/** The one-line rule the interface states next to the registry. */
export const CURRENCY_RULE =
  'Pair case-law retrieval with current primary sources, and carry the jurisdiction and the as-of date on every answer.'

/**
 * Where the cloned tools actually live.
 *
 * Deliberately outside the app bundle. These are tools and datasets: cloning CourtListener into
 * the app would add a Python web application to an Electron installer and still not make a
 * single opinion retrievable, because retrieval is an API call, not a file copy.
 */
export const RESEARCH_CLONE_DIR = 'F:\\Bianna - Law\\research'

export function sourcesByKind(kind: SourceKind): ResearchSource[] {
  return RESEARCH_SOURCES.filter((source) => source.kind === kind)
}
