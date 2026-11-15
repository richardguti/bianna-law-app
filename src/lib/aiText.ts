/**
 * Render a rich answer as readable plain text.
 *
 * Exists because the four-tier formatter is a SECOND model call. When it fails — dead
 * API key, network drop, provider outage, empty result — the answer must still be
 * legible. Without this, a formatter failure showed the student raw `<strong>` tags and
 * literal markdown: a real problem (formatting unavailable) wearing the costume of a
 * different problem (broken formatting). That confusion cost a full diagnostic cycle.
 *
 * Deliberately conservative: it removes markup and never rewrites, reorders or
 * summarises. What the model said is what the student reads. The one marker it keeps is
 * the outline-continuation note, because that is information, not decoration.
 */
export function plainFromRich(input: string): string {
  let t = String(input ?? '')

  // Block structure becomes newlines BEFORE any tag is removed, so paragraphs and
  // list items do not run together into one wall of text.
  t = t.replace(/<br\s*\/?>/gi, '\n')
  t = t.replace(/<\/(div|p|h[1-6]|li|tr|blockquote)>/gi, '\n')
  t = t.replace(/<li[^>]*>/gi, '\n- ')
  t = t.replace(/<hr\s*\/?>/gi, '\n')

  // Remaining tags are dropped but their text is kept.
  t = t.replace(/<[^>]+>/g, '')

  // Markdown emphasis, headings and code fences.
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1')
  t = t.replace(/__([^_]+)__/g, '$1')
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1$2')
  t = t.replace(/`{1,3}([^`]+)`{1,3}/g, '$1')

  // Entities the model emits in prose. Done after tag stripping so escaped angle
  // brackets in the source are not mistaken for markup.
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

  // Stripping block tags leaves blank-line damage; collapse it without losing
  // paragraph separation.
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')

  return t.trim()
}
