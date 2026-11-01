export const CITE_PREFIX = "#sentiora-cite-";

/**
 * Turn [S#] markers into links the renderer swaps for citation chips. Fenced
 * and inline code are left alone, so `arr[S1]`-like code is never touched.
 */
export function linkCitations(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/\[S(\d+)\](?!\()/g, `[S$1](${CITE_PREFIX}$1)`),
    )
    .join("");
}
