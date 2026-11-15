import { useNavigate } from 'react-router-dom'
import { ARTIFACTS, LIVE_AREAS, PRACTICE_AREAS } from '../lib/practiceAreas'

/**
 * Practice — the plugin index.
 *
 * The layout is the argument. A legal team's work is not a chat box: it is a set of
 * recurring matters, each with its own vocabulary, its own playbook, and its own notion of
 * what counts as finished. So the first screen after sign-in shows the twelve areas as a
 * ruled index rather than a prompt field, and the two roles that ship deepest are the two
 * that are filled.
 *
 * The grid is drawn with hairlines on the cells themselves (right + bottom) against a
 * container that owns the top + left rule. That is what keeps the outer border and the
 * internal dividers at exactly one pixel each, at every breakpoint, without a wrapper per
 * row — a border on the container alone would double up against the cell borders.
 */

export function Practice() {
  const navigate = useNavigate()

  return (
    <div className="p-8 max-w-[1400px] mx-auto space-y-10">
      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between border-b border-outline-variant pb-6">
        <div>
          <p className="label-micro">Claude for Legal · Plugin suite</p>
          <h1 className="text-4xl lg:text-5xl font-serif mt-3 leading-[1.05] text-on-surface">
            The twelve plugins for legal
          </h1>
        </div>
        <div className="lg:text-right shrink-0">
          <p className="label-micro">Senior Law Partner</p>
          <p className="cell-index mt-1.5">
            {LIVE_AREAS.length} of {PRACTICE_AREAS.length} live
          </p>
        </div>
      </header>

      <p className="text-[15px] leading-relaxed text-on-surface-variant max-w-3xl">
        Each plugin packages the workflows lawyers in that area run most often — not a chat
        persona, but a bundle of repeatable tasks. Two roles, <em>litigation</em> and{' '}
        <em>AI governance</em>, are detailed below.
      </p>

      {/* ── The twelve ───────────────────────────────────────────────────── */}
      <section aria-label="Practice areas">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 border-t border-l border-outline-variant">
          {PRACTICE_AREAS.map((area) => {
            const featured = Boolean(area.featured)
            const pending = Boolean(area.pending)

            // Complete literal strings per state — Tailwind's scanner cannot see a class
            // assembled from a fragment, and this grid is the whole visual identity.
            //
            // The Litigation cell uses on-surface/surface rather than primary/on-primary: the
            // featured cell must be the maximum-contrast cell in both themes, and in dark mode
            // `primary` is a light cream, which would have turned the "black" cell white.
            const shell = featured
              ? area.id === 'litigation'
                ? 'bg-on-surface text-surface border-outline-variant'
                : 'bg-accent text-on-accent border-outline-variant'
              : pending
                ? 'bg-transparent text-on-surface-variant border-outline-variant'
                : 'bg-surface text-on-surface border-outline-variant hover:bg-surface-container-lowest'

            const eyebrow = featured
              ? area.id === 'litigation'
                ? 'text-surface/60'
                : 'text-on-accent/70'
              : 'text-outline'

            return (
              <button
                key={area.id}
                type="button"
                onClick={() => navigate(`/practice/${area.id}`)}
                className={`text-left p-6 min-h-[210px] flex flex-col border-r border-b transition-colors ${shell} ${
                  pending ? 'cursor-default' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`cell-index ${eyebrow}`}>{area.index}</span>
                  {featured && <span className={`label-micro ${eyebrow}`}>★ Featured</span>}
                </div>

                <h2
                  className={`font-serif text-2xl mt-5 leading-tight ${
                    featured ? 'italic' : ''
                  }`}
                >
                  {area.name}
                </h2>

                {/* The description is pushed to the lower third, as the gallery does, so
                    the names line up across the row regardless of description length. */}
                <p
                  className={`text-[13px] leading-snug mt-auto pt-6 ${
                    featured
                      ? area.id === 'litigation'
                        ? 'text-surface/80'
                        : 'text-on-accent/90'
                      : 'text-on-surface-variant'
                  }`}
                >
                  {area.blurb}
                </p>

                {!pending && (
                  <p className={`cell-index mt-3 ${eyebrow}`}>
                    {area.skills.length} skill{area.skills.length === 1 ? '' : 's'}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      </section>

      {/* ── Artifacts ────────────────────────────────────────────────────── */}
      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4 border-b border-outline-variant pb-3">
          <div>
            <p className="label-micro">Artifact gallery</p>
            <h2 className="font-serif text-2xl mt-1.5 text-on-surface">
              Ready-to-use tools, not blank pages
            </h2>
          </div>
          <button
            type="button"
            onClick={() => navigate('/reviews')}
            className="text-xs font-label uppercase tracking-widest font-bold text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
          >
            All reviews →
          </button>
        </div>

        <p className="text-sm text-on-surface-variant max-w-3xl leading-relaxed">
          Each artifact opens with an example, so the work is visible before any data is
          attached. Bring your own documents and sources; every answer links back to the text
          it came from.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-outline-variant border border-outline-variant">
          {ARTIFACTS.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              onClick={() => navigate(artifact.route)}
              className="text-left bg-surface hover:bg-surface-container-lowest transition-colors p-5 space-y-2"
            >
              <p className="label-micro">{artifact.name}</p>
              <p className="font-serif text-lg leading-tight text-on-surface">{artifact.verb}</p>
              <p className="text-[13px] leading-snug text-on-surface-variant">{artifact.blurb}</p>
            </button>
          ))}
        </div>
      </section>

      {/* ── Practice profile ─────────────────────────────────────────────── */}
      <section className="bg-primary text-on-primary p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="max-w-2xl">
          <p className="label-micro text-on-primary/60">Cold start</p>
          <h2 className="font-serif text-2xl mt-2 leading-tight">
            Every skill reads from one practice profile.
          </h2>
          <p className="text-sm text-on-primary/75 mt-2 leading-relaxed">
            Skipping the interview is the single most common reason a skill returns generic
            output. Ten to twenty minutes here calibrates every other screen in the app.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/profile')}
          className="shrink-0 bg-on-primary text-primary px-6 py-3 label-micro hover:opacity-90 transition-opacity"
        >
          Open the interview →
        </button>
      </section>
    </div>
  )
}
