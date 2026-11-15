import { useNavigate, useParams } from 'react-router-dom'
import { artifactById, practiceAreaById } from '../lib/practiceAreas'

/**
 * PracticeArea — one plugin, examined.
 *
 * The unit of work in the suite is a namespaced command, not a page: `commercial-legal:review`
 * is a thing you run, and the reason the namespace matters is that it decides which playbook,
 * which sources, and which review track apply before a word is typed.
 *
 * This screen exists to make that visible. It lists what the area can do, what each command
 * needs to be useful, and — when the practice profile is still empty — says so on the skill
 * rather than letting it return generic output silently.
 */

export function PracticeArea() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const area = id ? practiceAreaById(id) : undefined

  if (!area) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="flex flex-col items-center gap-4 py-20 text-on-surface-variant">
          <span className="material-symbols-outlined text-5xl text-outline-variant">
            extension_off
          </span>
          <p className="font-serif text-xl">No such practice area</p>
          <button
            type="button"
            onClick={() => navigate('/practice')}
            className="text-xs font-label uppercase tracking-widest font-bold text-on-surface-variant hover:text-on-surface transition-colors"
          >
            ← Back to the index
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <button
        type="button"
        onClick={() => navigate('/practice')}
        className="text-xs font-label uppercase tracking-widest font-bold text-on-surface-variant hover:text-on-surface transition-colors"
      >
        ← The twelve
      </button>

      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <header className="border-b border-outline-variant pb-6">
        <div className="flex items-center gap-3">
          <span className="cell-index">{area.index}</span>
          {area.featured && <span className="label-micro text-accent">★ Featured</span>}
          <span className="cell-index">{area.namespace}:</span>
        </div>
        <h1 className={`text-4xl font-serif mt-3 leading-tight text-on-surface ${area.featured ? 'italic' : ''}`}>
          {area.name}
        </h1>
        <p className="text-[15px] text-on-surface-variant mt-2 leading-relaxed max-w-2xl">
          {area.blurb}
        </p>
      </header>

      {area.pending ? (
        <div className="border border-outline-variant p-8 text-center space-y-2">
          <p className="font-serif text-xl text-on-surface">Reserved</p>
          <p className="text-sm text-on-surface-variant max-w-md mx-auto leading-relaxed">
            This slot is part of the published lineup but has no skills yet. It is shown
            rather than hidden so the index reflects what actually ships.
          </p>
        </div>
      ) : (
        <>
          {/* ── Skills ─────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-end justify-between border-b border-outline-variant pb-2">
              <h2 className="font-serif text-2xl text-on-surface">Skills</h2>
              <p className="label-micro">{area.skills.length} available</p>
            </div>

            <div className="border border-outline-variant divide-y divide-outline-variant">
              {area.skills.map((skill) => {
                const artifact = skill.artifact ? artifactById(skill.artifact) : undefined
                return (
                  <div
                    key={skill.command}
                    className="p-5 flex flex-col md:flex-row md:items-center gap-4 bg-surface"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="citation">
                        {area.namespace}:{skill.command}
                      </p>
                      <p className="font-serif text-lg text-on-surface mt-1 leading-tight">
                        {skill.label}
                      </p>
                      <p className="text-[13px] text-on-surface-variant mt-1 leading-snug">
                        {skill.what}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {artifact && (
                        <button
                          type="button"
                          onClick={() => navigate(artifact.route)}
                          className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 border border-outline-variant text-on-surface-variant hover:border-on-surface hover:text-on-surface transition-colors"
                        >
                          {artifact.name}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => navigate(skill.route ?? area.route ?? '/assistant')}
                        className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 bg-primary text-on-primary hover:opacity-90 transition-opacity"
                      >
                        Open
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* ── What this area needs ───────────────────────────────────── */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-px bg-outline-variant border border-outline-variant">
            <div className="bg-surface p-5 space-y-2">
              <p className="label-micro">Reads from</p>
              <p className="font-serif text-lg text-on-surface leading-tight">
                The practice profile
              </p>
              <p className="text-[13px] text-on-surface-variant leading-snug">
                Risk tolerance, standard positions, and who approves each exception. Without
                it these commands still run — they just run generically.
              </p>
              <button
                type="button"
                onClick={() => navigate('/profile')}
                className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 border border-outline-variant text-on-surface-variant hover:border-on-surface hover:text-on-surface transition-colors"
              >
                Configure →
              </button>
            </div>

            <div className="bg-surface p-5 space-y-2">
              <p className="label-micro">Maps sources through</p>
              <p className="font-serif text-lg text-on-surface leading-tight">
                The authority engine
              </p>
              <p className="text-[13px] text-on-surface-variant leading-snug">
                Every finding is anchored to a character range in a source, and weighed by
                tier and citator status before it can support a conclusion.
              </p>
              <button
                type="button"
                onClick={() => navigate('/sources')}
                className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 border border-outline-variant text-on-surface-variant hover:border-on-surface hover:text-on-surface transition-colors"
              >
                Inspect →
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
