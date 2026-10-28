import { createContext, memo, useContext, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { StreamSource } from "../../../services/askStream";
import { CitationChip } from "./CitationChip";
import { CITE_PREFIX, linkCitations } from "./citations";
import type { OpenMemory } from "./types";

interface AnswerMarkdownProps {
  text: string;
  sources: StreamSource[];
  onOpenMemory?: OpenMemory;
  /** Shows a caret after the text while the answer streams in. */
  streaming?: boolean;
}

interface CitationContextValue {
  byNumber: Map<string, StreamSource>;
  onOpenMemory?: OpenMemory;
}

// Sources reach the link renderer through context, so every renderer below is
// a module constant: new function identities would make React remount the
// answer (and close an open chip preview) on each token or parent render.
const CitationContext = createContext<CitationContextValue>({ byNumber: new Map() });

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const { byNumber, onOpenMemory } = useContext(CitationContext);
  if (href?.startsWith(CITE_PREFIX)) {
    const source = byNumber.get(href.slice(CITE_PREFIX.length));
    // A marker for a source that wasn't supplied shows nothing.
    return source ? <CitationChip source={source} onOpenMemory={onOpenMemory} /> : null;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-link underline">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

const REMARK_PLUGINS = [remarkGfm];
const DISALLOWED = ["img"];

const COMPONENTS: Components = {
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul className="ml-5 list-disc space-y-1.5">{children}</ul>,
  ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1.5">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  h1: ({ children }) => <h3 className="pt-2 text-[18px] font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="pt-2 text-[18px] font-semibold">{children}</h3>,
  h3: ({ children }) => <h3 className="pt-2 text-[17px] font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="pt-1 text-[17px] font-semibold">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-line pl-4 text-muted">{children}</blockquote>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-btn bg-raised p-4 font-mono text-[15px] leading-normal [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  code: ({ children, className }) => (
    <code className={`rounded bg-raised px-1.5 py-0.5 font-mono text-[15px] ${className ?? ""}`}>
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[15px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line px-3 py-2 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-line px-3 py-2 align-top">{children}</td>,
  hr: () => null,
};

/** The answer as Markdown (no raw HTML, no images) with [S#] citation chips. */
export const AnswerMarkdown = memo(function AnswerMarkdown({
  text,
  sources,
  onOpenMemory,
  streaming = false,
}: AnswerMarkdownProps): ReactNode {
  const citations = useMemo<CitationContextValue>(
    () => ({
      byNumber: new Map(sources.map((source) => [source.id.replace(/^S/, ""), source])),
      onOpenMemory,
    }),
    [sources, onOpenMemory],
  );

  return (
    <CitationContext.Provider value={citations}>
      <div className="space-y-3 break-words text-[17px] leading-relaxed text-fg">
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          components={COMPONENTS}
          disallowedElements={DISALLOWED}
          unwrapDisallowed
        >
          {linkCitations(text)}
        </ReactMarkdown>
        {streaming ? (
          <span
            aria-hidden="true"
            className="inline-block h-5 w-2 animate-pulse rounded-sm bg-accent align-[-3px] motion-reduce:animate-none"
          />
        ) : null}
      </div>
    </CitationContext.Provider>
  );
});
