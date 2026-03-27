import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, BIANNA_USER_ID, type DocumentRow } from '../lib/supabase'

const api = () => (window as any).seniorPartner

type DocumentMode    = 'full_outline' | 'case_brief' | 'irac_memo' | 'checklist_audit' | 'flash_card' | 'custom'
type DocumentSubject = 'contracts' | 'torts' | 'civ_pro' | 'constitutional' | 'property' | 'other'

const MODE_LABELS: Record<DocumentMode, string> = {
  full_outline:    'Full Outline',
  case_brief:      'Case Brief',
  irac_memo:       'IRAC Memo',
  checklist_audit: 'Checklist Audit',
  flash_card:      'Flash Card',
  custom:          'Custom',
}

const SUBJECT_LABELS: Record<DocumentSubject, string> = {
  contracts:      'Contracts',
  torts:          'Torts',
  civ_pro:        'Civ Pro',
  constitutional: 'Con Law',
  property:       'Property',
  other:          'Other',
}

const MODE_ICON: Record<DocumentMode, string> = {
  full_outline:    'list_alt',
  case_brief:      'gavel',
  irac_memo:       'article',
  checklist_audit: 'fact_check',
  flash_card:      'bolt',
  custom:          'edit_note',
}

export function DocumentVault() {
  const qc = useQueryClient()
  const [search,      setSearch]      = useState('')
  const [filterSub,   setFilterSub]   = useState<DocumentSubject | 'all'>('all')
  const [filterMode,  setFilterMode]  = useState<DocumentMode | 'all'>('all')
  const [viewId,      setViewId]      = useState<string | null>(null)
  const [viewContent, setViewContent] = useState<string>('')
  const [uploading,   setUploading]   = useState(false)
  const [uploadModal, setUploadModal] = useState(false)
  const [upTopic,     setUpTopic]     = useState('')
  const [upSubject,   setUpSubject]   = useState<DocumentSubject>('contracts')
  const [upMode,      setUpMode]      = useState<DocumentMode>('full_outline')
  const [upText,      setUpText]      = useState('')
  const [upFileName,  setUpFileName]  = useState<string | null>(null)
  const [renamingId,  setRenamingId]  = useState<string | null>(null)
  const [renameVal,   setRenameVal]   = useState('')

  const { data: docs = [] } = useQuery<DocumentRow[]>({
    queryKey: ['documents', filterSub, filterMode, search],
    queryFn: async () => {
      let q = supabase.from('documents').select('*').eq('user_id', BIANNA_USER_ID)
      if (filterSub  !== 'all') q = q.eq('subject', filterSub)
      if (filterMode !== 'all') q = q.eq('mode', filterMode)
      if (search)               q = q.ilike('topic', `%${search}%`)
      const { data } = await q.order('created_at', { ascending: false })
      return (data ?? []) as DocumentRow[]
    },
  })

  const deleteDoc = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('documents').delete().eq('id', id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] })
      if (viewId) { setViewId(null); setViewContent('') }
    },
  })

  const renameDoc = useMutation({
    mutationFn: async ({ id, topic }: { id: string; topic: string }) => {
      await supabase.from('documents').update({ topic }).eq('id', id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] })
      setRenamingId(null)
      setRenameVal('')
    },
  })

  function openDoc(id: string, html: string) {
    setViewId(id)
    setViewContent(html)
  }

  function copyHtml(html: string) {
    navigator.clipboard.writeText(html)
  }

  function downloadHtml(topic: string, html: string) {
    const blob = new Blob([html], { type: 'text/html' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${topic.replace(/\s+/g, '_')}_outline.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar filters */}
      <aside className="w-56 shrink-0 bg-surface-container-low border-r border-outline-variant/10 p-5 flex flex-col gap-6 overflow-y-auto no-scrollbar">
        <div>
          <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mb-3">Subject</p>
          {(['all', 'contracts', 'torts', 'civ_pro', 'constitutional', 'property', 'other'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterSub(s)}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-label transition-colors mb-0.5 ${
                filterSub === s ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {s === 'all' ? 'All Subjects' : SUBJECT_LABELS[s]}
            </button>
          ))}
        </div>

        <div>
          <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mb-3">Mode</p>
          {(['all', 'full_outline', 'case_brief', 'irac_memo', 'checklist_audit', 'flash_card', 'custom'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setFilterMode(m)}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-label transition-colors mb-0.5 ${
                filterMode === m ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {m === 'all' ? 'All Modes' : MODE_LABELS[m]}
            </button>
          ))}
        </div>

        <div className="mt-auto text-center">
          <p className="text-2xl font-serif text-primary">{docs.length}</p>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Documents</p>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search bar */}
        <div className="shrink-0 px-6 py-4 border-b border-outline-variant/10 bg-surface-container-lowest flex items-center gap-4">
          <div className="relative max-w-md flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-base">search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by topic…"
              className="w-full bg-surface-container-low rounded-full pl-10 pr-4 py-2.5 text-sm outline-none border border-outline-variant/20 focus:border-primary transition-colors"
            />
          </div>
          <button
            onClick={() => setUploadModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-on-primary text-xs font-bold hover:opacity-90 transition-opacity shrink-0"
          >
            <span className="material-symbols-outlined text-sm">upload_file</span>
            Upload to Vault
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Document grid */}
          <div className="flex-1 overflow-y-auto p-6">
            {docs.length === 0 ? (
              <div className="flex flex-col items-center gap-4 mt-16 text-on-surface-variant">
                <span className="material-symbols-outlined text-5xl text-outline-variant">folder_managed</span>
                <p className="font-serif text-xl">Vault is empty</p>
                <p className="text-sm text-center">Generate outlines and save them here using the "Add to Vault" button in the Outline Generator.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {docs.map((doc) => (
                  <div
                    key={doc.id}
                    className={`bg-surface-container-lowest rounded-xl p-5 border transition-all cursor-pointer shadow-[var(--shadow-sm)] ${
                      viewId === doc.id ? 'border-primary' : 'border-outline-variant/10 hover:border-primary/30'
                    }`}
                    onClick={() => openDoc(doc.id, doc.html_content)}
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <span className="material-symbols-outlined text-primary-container text-xl mt-0.5">{MODE_ICON[doc.mode as DocumentMode]}</span>
                      <div className="flex-1 min-w-0">
                        {renamingId === doc.id ? (
                          <form
                            onSubmit={(e) => { e.preventDefault(); if (renameVal.trim()) renameDoc.mutate({ id: doc.id, topic: renameVal.trim() }) }}
                            onClick={(e) => e.stopPropagation()}
                            className="flex gap-1"
                          >
                            <input
                              autoFocus
                              value={renameVal}
                              onChange={(e) => setRenameVal(e.target.value)}
                              className="flex-1 min-w-0 text-sm bg-surface-container-low border border-primary rounded px-2 py-0.5 outline-none"
                            />
                            <button type="submit" className="text-primary"><span className="material-symbols-outlined text-sm">check</span></button>
                            <button type="button" onClick={() => setRenamingId(null)} className="text-on-surface-variant"><span className="material-symbols-outlined text-sm">close</span></button>
                          </form>
                        ) : (
                          <p className="font-semibold text-sm text-on-surface truncate">{doc.topic}</p>
                        )}
                        <p className="text-[10px] text-on-surface-variant mt-0.5">
                          {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-[10px] bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                        {SUBJECT_LABELS[doc.subject as DocumentSubject]}
                      </span>
                      <span className="text-[10px] bg-surface-container-high text-on-surface-variant px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                        {MODE_LABELS[doc.mode as DocumentMode]}
                      </span>
                    </div>
                    <div className="flex gap-1 mt-3 pt-3 border-t border-outline-variant/10">
                      <button
                        onClick={(e) => { e.stopPropagation(); setRenamingId(doc.id); setRenameVal(doc.topic) }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-on-surface-variant hover:bg-surface-container-high transition-colors"
                        title="Rename"
                      >
                        <span className="material-symbols-outlined text-sm">edit</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); copyHtml(doc.html_content) }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-on-surface-variant hover:bg-surface-container-high transition-colors"
                        title="Copy HTML"
                      >
                        <span className="material-symbols-outlined text-sm">content_copy</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); downloadHtml(doc.topic, doc.html_content) }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-on-surface-variant hover:bg-surface-container-high transition-colors"
                        title="Download HTML"
                      >
                        <span className="material-symbols-outlined text-sm">download</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); if (confirm('Delete this outline?')) deleteDoc.mutate(doc.id) }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-on-surface-variant hover:text-error hover:bg-error-container/30 transition-colors"
                        title="Delete"
                      >
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Preview panel */}
          {viewId && (
            <div className="w-[480px] shrink-0 border-l border-outline-variant/10 bg-surface-container-lowest flex flex-col overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-outline-variant/10 bg-surface-container-low shrink-0">
                <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant flex-1">Preview</p>
                <button onClick={() => { setViewId(null); setViewContent('') }} className="text-on-surface-variant hover:text-primary">
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
              <div
                className="flex-1 overflow-y-auto p-6 bia-outline"
                dangerouslySetInnerHTML={{ __html: viewContent }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Upload Modal */}
      {uploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-outline-variant/10 bg-surface-container-low">
              <span className="material-symbols-outlined text-primary">upload_file</span>
              <p className="font-semibold text-sm flex-1">Upload Document to Vault</p>
              <button onClick={() => { setUploadModal(false); setUpText(''); setUpFileName(null); setUpTopic('') }} className="text-on-surface-variant hover:text-primary">
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4 overflow-y-auto">
              {/* Topic */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1.5">Topic / Title</label>
                <input
                  value={upTopic}
                  onChange={(e) => setUpTopic(e.target.value)}
                  placeholder="e.g. Offer and Acceptance"
                  className="w-full bg-surface-container-low rounded-lg px-3 py-2.5 text-sm outline-none border border-outline-variant/20 focus:border-primary transition-colors"
                />
              </div>
              {/* Subject */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1.5">Subject</label>
                <select
                  value={upSubject}
                  onChange={(e) => setUpSubject(e.target.value as DocumentSubject)}
                  className="w-full bg-surface-container-low rounded-lg px-3 py-2.5 text-sm outline-none border border-outline-variant/20 focus:border-primary transition-colors"
                >
                  {(Object.keys(SUBJECT_LABELS) as DocumentSubject[]).map((s) => (
                    <option key={s} value={s}>{SUBJECT_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              {/* Mode */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1.5">Document Type</label>
                <select
                  value={upMode}
                  onChange={(e) => setUpMode(e.target.value as DocumentMode)}
                  className="w-full bg-surface-container-low rounded-lg px-3 py-2.5 text-sm outline-none border border-outline-variant/20 focus:border-primary transition-colors"
                >
                  {(Object.keys(MODE_LABELS) as DocumentMode[]).map((m) => (
                    <option key={m} value={m}>{MODE_LABELS[m]}</option>
                  ))}
                </select>
              </div>
              {/* File or text */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1.5">Content</label>
                <button
                  onClick={async () => {
                    const sp = (window as any).seniorPartner
                    const result = await sp?.pickAndReadFile?.()
                    if (!result || result.canceled || !result.success) return
                    if (result.isImage) return
                    setUpText(result.text ?? '')
                    setUpFileName(result.fileName)
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-outline-variant/40 text-xs text-on-surface-variant hover:border-primary hover:text-primary transition-colors mb-2 w-full justify-center"
                >
                  <span className="material-symbols-outlined text-sm">attach_file</span>
                  {upFileName ? upFileName : 'Pick PDF / DOCX / TXT'}
                </button>
                <textarea
                  value={upText}
                  onChange={(e) => setUpText(e.target.value)}
                  placeholder="Or paste / type your content here…"
                  rows={8}
                  className="w-full bg-surface-container-low rounded-lg px-3 py-2.5 text-sm outline-none border border-outline-variant/20 focus:border-primary transition-colors resize-none font-mono"
                />
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-outline-variant/10 bg-surface-container-low justify-end">
              <button
                onClick={() => { setUploadModal(false); setUpText(''); setUpFileName(null); setUpTopic('') }}
                className="px-4 py-2 rounded-full text-xs font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={uploading || !upTopic.trim() || !upText.trim()}
                onClick={async () => {
                  if (!upTopic.trim() || !upText.trim()) return
                  setUploading(true)
                  try {
                    const html = `<div class="bia-outline"><pre style="white-space:pre-wrap;font-family:inherit">${upText.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></div>`
                    const { error } = await supabase.from('documents').insert({
                      user_id: BIANNA_USER_ID,
                      topic:   upTopic.trim(),
                      subject: upSubject,
                      mode:    upMode,
                      html_content: html,
                    })
                    if (!error) {
                      qc.invalidateQueries({ queryKey: ['documents'] })
                      setUploadModal(false)
                      setUpText('')
                      setUpFileName(null)
                      setUpTopic('')
                    }
                  } finally {
                    setUploading(false)
                  }
                }}
                className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-primary text-on-primary text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-sm">{uploading ? 'hourglass_empty' : 'save'}</span>
                {uploading ? 'Saving…' : 'Save to Vault'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
