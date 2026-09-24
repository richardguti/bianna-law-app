import { sanitizeBia } from '../lib/sanitizeBia'

/**
 * ChatBubble — the single renderer for model answers across every chat surface.
 *
 * Two stages, so the user sees something immediately and something correct when it settles:
 *   streaming  → the raw answer as pre-wrapped text (transient, readable, unparsed)
 *   finished   → the house four-tier HTML, sanitised
 *
 * Streaming deliberately does NOT parse markdown. That would mean react-markdown and a
 * second parser surface for a view that exists for a few seconds; pre-wrap reads fine and
 * costs nothing. The finished artifact is the only thing ever inserted as HTML, and it goes
 * through sanitizeBia first - no exceptions, including for our own formatter's output.
 */
interface Props {
  /** Raw answer text while it is still arriving. */
  streamingText?: string
  /** Finished house-stylesheet HTML. */
  biaHtml?: string | null
  isStreaming?: boolean
  /** Shown when no BIA artifact exists (formatter unavailable) - as plain text. */
  plainText?: string
}

export function ChatBubble({ streamingText, biaHtml, isStreaming, plainText }: Props) {
  if (isStreaming || (!biaHtml && streamingText)) {
    return (
      <div className="chat-stream whitespace-pre-wrap break-words" data-chat-bubble="streaming">
        {streamingText}
      </div>
    )
  }

  if (biaHtml) {
    return (
      <div
        className="chat-bia"
        data-chat-bubble="bia"
        dangerouslySetInnerHTML={{ __html: sanitizeBia(biaHtml) }}
      />
    )
  }

  if (plainText) {
    return (
      <div className="chat-stream whitespace-pre-wrap break-words" data-chat-bubble="plain">
        {plainText}
      </div>
    )
  }

  return null
}
