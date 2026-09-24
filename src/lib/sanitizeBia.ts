/**
 * sanitizeBia — the only path from model-authored HTML into the DOM.
 *
 * DOMParser parses into an INERT document: no script runs and no resource is fetched during
 * parsing, so it is a safe parsing step. The tree it returns is then walked and rebuilt, and
 * only the rebuilt node is serialised. Nothing from the parsed document is ever inserted
 * directly.
 *
 * Ordering here is deliberate and load-bearing: the blocklists are applied BEFORE the
 * allowlist. Most sanitizer vulnerabilities come from a whitelist gaining a tag before the
 * attribute guard for that tag exists, so these guards are independent of the tag
 * whitelist - if <a> is ever allowed, href/src/xlink:href are already refused, and every
 * on* handler is refused on every element no matter what the whitelist says.
 */

/** The only elements permitted in output. */
const ALLOWED_TAGS = new Set(['div', 'span', 'strong', 'em', 'br', 'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li']);

/** Refused unconditionally, regardless of any future whitelist change. */
const BLOCKED_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base',
  'style', 'svg', 'math', 'template', 'noscript', 'frame', 'frameset', 'applet',
]);

/** Attributes refused on ANY tag: event handlers and every navigational/loading vector. */
const BLOCKED_ATTR_PREFIXES = ['on'];
const BLOCKED_ATTRS = new Set(['href', 'src', 'srcset', 'formaction', 'action', 'xlink:href', 'srcdoc', 'ping', 'background', 'poster']);

/** style is permitted, but only these properties... */
const ALLOWED_STYLE_PROP = /^(color|background(-color)?|border(-bottom)?|padding|margin|font(-weight|-size|-family)?|text-(align|transform)|line-height|max-width)$/;

/** ...and never with these values, which can load or execute. */
const BLOCKED_STYLE_VALUE = /url\(|expression\(|@import|javascript:|vbscript:|behavior|-moz-binding/i;

/** style is the only attribute currently allowed through. */
const ALLOWED_ATTRS = new Set(['style']);

/** Keep only whitelisted properties whose values cannot load or execute anything. */
function safeStyle(style: string): string {
  const kept: string[] = [];
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const prop = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (!prop || !value) continue;
    if (!ALLOWED_STYLE_PROP.test(prop)) continue;
    if (BLOCKED_STYLE_VALUE.test(value)) continue;
    kept.push(`${prop}: ${value}`);
  }
  return kept.join('; ');
}

function rebuild(node: Node, parent: HTMLElement): void {
  // Text survives as text (never re-parsed as HTML).
  if (node.nodeType === Node.TEXT_NODE) {
    parent.appendChild(document.createTextNode(node.nodeValue ?? ''));
    return;
  }
  // Comments, CDATA and everything else that is not an element is dropped.
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (BLOCKED_TAGS.has(tag)) return;

  if (!ALLOWED_TAGS.has(tag)) {
    // Unknown element: keep its contents, drop the element itself. Costs styling, never
    // loses text, and cannot smuggle in a container we did not sanction.
    for (const child of Array.from(el.childNodes)) rebuild(child, parent);
    return;
  }

  const clean = document.createElement(tag);

  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    // Blocklist first: these stay refused even if an attribute allowlist widens later.
    if (BLOCKED_ATTR_PREFIXES.some((p) => name.startsWith(p))) continue;
    if (BLOCKED_ATTRS.has(name)) continue;
    if (!ALLOWED_ATTRS.has(name)) continue;
    if (name === 'style') {
      const safe = safeStyle(attr.value);
      if (safe) clean.setAttribute('style', safe);
    }
  }

  for (const child of Array.from(el.childNodes)) rebuild(child, clean);
  parent.appendChild(clean);
}

/**
 * Returns a safe HTML string. Never returns the input unchanged, and never returns raw
 * input as a fallback: if the DOM is unavailable the answer is an empty string, because an
 * unsanitised fallback is worse than no rendering at all.
 */
export function sanitizeBia(html: string | null | undefined): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') return '';
  const parsed = new DOMParser().parseFromString(String(html), 'text/html');
  const container = document.createElement('div');
  for (const node of Array.from(parsed.body.childNodes)) rebuild(node, container);
  return container.innerHTML;
}
