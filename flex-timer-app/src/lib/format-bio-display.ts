/**
 * Normalize stored bio text for display: unify line endings, optional HTML `<br>` from clients,
 * and Unicode line/paragraph separators so `white-space: pre-wrap` renders predictably.
 */
export function normalizeBioDisplayText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u2028/g, '\n')
    .replace(/\u2029/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
}
