import { sanitizeBia } from '../lib/sanitizeBia'
import { plainFromRich } from '../lib/aiText'

/**
 * ChatBubble — the single renderer for model answers across every chat surface.
 *
 * Three stages, so the user always sees something honest:
 *   streaming        → the raw answer as pre-wrapped text (transient, readable, unparsed)
 *   finished + BIA   → the house four-tier HTML, sanitised
 *   finished, no BIA → the answer as stripped plain text, plus a visible notice IF the
 *                      formatter actually failed
 *
 * Streaming deliberately does NOT parse markdown. That would mean react-markdown and a
 * second parser surface for a view that exists for a few seconds; pre-wrap reads fine and
 * costs nothing. The finished artifact is the only thing ever inserted as HTML, and it goes
 * through sanitizeBia first - no exceptions, including for our own formatter's output.
 *
 * The `formatFailed` notice exists because silent degradation was the actual bug: when the
 * formatter returned nothing, the user saw raw tags with no explanation and reasonably read
 * it as a rendering fault. Note it is deliberately NOT shown when formatting was bypassed
 * on purpose (Socratic/dialogue passthrough returns success with a null artifact) - telling
 * a student that formatting is unavailable when plain text was the intended output would
 * introduce a new bug in place of the old one.
 */
interface Props {
  /** Raw answer text while it is still arriving. */
  streamingText?: string
  /** Finished house-stylesheet HTML. */
  biaHtml?: string | null
  isStreaming?: boolean
  /** Shown when no BIA artifact exists - as plain text. */
  plainText?: string
  /** The formatter was attempted and did not return an artifact. */
  formatFailed?: boolean
  /** Re-run the formatter for this message only. */
  onRetryFormat?: () => void
}

export function ChatBubble({
  streamingText, biaHtml, isStreaming, plainText, formatFailed, onRetryFormat,
}: Props) {
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
      <div className="chat-stream" data-chat-bubble="plain">
        {formatFailed && (
          <div
            className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant"
            data-testid="format-notice"
          >
            <span>Formatting unavailable — showing the unformatted answer.</span>
            {onRetryFormat && (
              <button
                type="button"
                onClick={onRetryFormat}
                className="underline underline-offset-2 hover:text-primary transition-colors"
              >
                Retry formatting
              </button>
            )}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">{plainFromRich(plainText)}</div>
      </div>
    )
  }

  return null
}

