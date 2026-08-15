import { Readability } from "@mozilla/readability";
import type { WebpageCapturePayload, StructuredNode, NodeType } from "../shared/types";
import {
  capExtractedContent,
  buildPlainTextFromNodes,
  scoreExtractionQuality,
} from "../shared/captureUtils";

const JUNK_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "canvas",
  "svg",
  "video",
  "audio",
  "picture source",
  "link",
  "form",
  "nav",
  "footer",
  "aside",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='complementary']",
  "[aria-hidden='true']",
  ".ad",
  ".ads",
  ".advertisement",
  ".sidebar",
  "#comments",
  ".comments",
  ".comment-section",
].join(",");

const SEMANTIC_TEXT_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,figcaption,td,th";
const MAX_ELEMS_FOR_READABILITY = 2500;
const MIN_CONTENT_LENGTH = 50;

export interface WebpageExtractionResult {
  payload: WebpageCapturePayload;
  extractionMs: number;
}

export function getExtractionRoot(doc: Document = document): Element {
  return (
    doc.querySelector("article") ||
    doc.querySelector("[role='main']") ||
    doc.querySelector("main") ||
    doc.body
  );
}

export function stripNonContentNodes(root: Element): void {
  root.querySelectorAll(JUNK_SELECTOR).forEach((node) => node.remove());
}

/** Legacy fallback: produce flat text from the DOM (Phase 1 behaviour). */
export function extractSemanticText(root: Element): string {
  const parts: string[] = [];
  root.querySelectorAll(SEMANTIC_TEXT_SELECTOR).forEach((node) => {
    const text = node.textContent?.replace(/\s+/g, " ").trim();
    if (text) {
      parts.push(text);
    }
  });
  return parts.join("\n\n");
}

// ──────────────────────────────────────────────
// StructuredNode extraction from a parsed DOM
// ──────────────────────────────────────────────

/** Detect code language from class attribute (e.g., language-python, highlight-js). */
function detectCodeLanguage(el: Element): string | undefined {
  // Check the element itself and any nested code element
  const candidates = [el, el.querySelector("code")].filter(Boolean) as Element[];
  for (const candidate of candidates) {
    const classList = candidate.className ?? "";
    const match =
      /language-(\w+)/.exec(classList) ??
      /highlight-(\w+)/.exec(classList) ??
      /lang-(\w+)/.exec(classList);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return undefined;
}

/** Walk the parsed Readability HTML and produce a flat StructuredNode[]. */
export function extractStructuredNodes(root: Element): StructuredNode[] {
  const nodes: StructuredNode[] = [];
  let order = 0;
  // headingStack tracks the last seen heading node id at each heading level
  // so paragraphs/lists can be assigned the correct parent.
  const headingStack: Map<number, string> = new Map();

  function getClosestHeadingParent(level: number): string | null {
    // Find the nearest heading of a level HIGHER (lower number) than current
    for (let l = level - 1; l >= 1; l--) {
      const id = headingStack.get(l);
      if (id) return id;
    }
    return null;
  }

  function getLastHeadingParent(): string | null {
    let bestLevel = -1;
    let bestId: string | null = null;
    headingStack.forEach((id, level) => {
      if (level > bestLevel) {
        bestLevel = level;
        bestId = id;
      }
    });
    return bestId;
  }

  function makeId(): string {
    return `node-${order}`;
  }

  function isHidden(el: Element): boolean {
    if ((el as HTMLElement).hidden) return true;
    const style = (el as HTMLElement).style;
    if (style?.display === "none" || style?.visibility === "hidden") return true;
    return false;
  }

  function processNode(el: Element): void {
    if (isHidden(el)) return;

    const tag = el.tagName.toLowerCase();

    // ── Headings ────────────────────────────────
    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag[1]!, 10);
      const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (!text) return;

      // Clear heading stack for levels >= current (sibling/deeper headings)
      for (let l = level; l <= 6; l++) headingStack.delete(l);

      const parent_id = getClosestHeadingParent(level);
      const id = makeId();
      headingStack.set(level, id);

      nodes.push({
        id,
        type: "heading",
        text,
        order: order++,
        parent_id,
        metadata: { level },
      });
      return;
    }

    // ── Code blocks ─────────────────────────────
    if (tag === "pre") {
      // Extract raw text preserving indentation inside the pre/code element
      const codeEl = el.querySelector("code") ?? el;
      const text = codeEl.textContent ?? "";
      if (!text.trim()) return;

      nodes.push({
        id: makeId(),
        type: "code_block",
        text, // preserve raw whitespace
        order: order++,
        parent_id: getLastHeadingParent(),
        metadata: { language: detectCodeLanguage(el) },
      });
      return;
    }

    // Skip standalone <code> inside non-pre (inline code) — don't create separate node
    if (tag === "code" && el.parentElement?.tagName.toLowerCase() !== "pre") {
      return;
    }

    // ── Paragraphs ───────────────────────────────
    if (tag === "p" || tag === "figcaption") {
      const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (text.length < 5) return;

      nodes.push({
        id: makeId(),
        type: "paragraph",
        text,
        order: order++,
        parent_id: getLastHeadingParent(),
      });
      return;
    }

    // ── Blockquotes ──────────────────────────────
    if (tag === "blockquote") {
      const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (!text) return;

      nodes.push({
        id: makeId(),
        type: "blockquote",
        text,
        order: order++,
        parent_id: getLastHeadingParent(),
      });
      return;
    }

    // ── Tables ───────────────────────────────────
    if (tag === "table") {
      const rows = el.querySelectorAll("tr");
      let rowIdx = 0;
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td,th");
        let colIdx = 0;
        cells.forEach((cell) => {
          const text = cell.textContent?.replace(/\s+/g, " ").trim() ?? "";
          if (text) {
            nodes.push({
              id: makeId(),
              type: "table",
              text,
              order: order++,
              parent_id: getLastHeadingParent(),
              metadata: { row_index: rowIdx, col_index: colIdx },
            });
          }
          colIdx++;
        });
        rowIdx++;
      });
      return;
    }

    // ── List items ───────────────────────────────
    if (tag === "li") {
      const listStyle =
        el.parentElement?.tagName.toLowerCase() === "ol" ? "ordered" : "unordered";
      // Get direct text content excluding nested lists
      let text = "";
      el.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          text += child.textContent ?? "";
        } else if (
          child.nodeType === Node.ELEMENT_NODE &&
          !["ul", "ol"].includes((child as Element).tagName.toLowerCase())
        ) {
          text += (child as Element).textContent ?? "";
        }
      });
      text = text.replace(/\s+/g, " ").trim();
      if (text.length < 3) return;

      nodes.push({
        id: makeId(),
        type: "list_item",
        text,
        order: order++,
        parent_id: getLastHeadingParent(),
        metadata: { list_style: listStyle },
      });

      // Recurse into nested lists
      el.querySelectorAll("ul,ol").forEach((nestedList) => {
        nestedList.querySelectorAll(":scope > li").forEach(processNode);
      });
      return;
    }

    // ── Container elements — recurse into children ──────────────────────────
    const RECURSE_TAGS = new Set([
      "article", "section", "main", "div", "body",
      "ul", "ol", "dl", "dd", "dt", "figure",
      "header", "summary", "details",
    ]);
    if (RECURSE_TAGS.has(tag)) {
      Array.from(el.children).forEach(processNode);
    }
  }

  Array.from(root.children).forEach(processNode);
  return nodes;
}

// ──────────────────────────────────────────────
// Fallback: produce StructuredNode[] from raw DOM
// ──────────────────────────────────────────────

export function extractFallbackNodes(root: Element): StructuredNode[] {
  const nodes: StructuredNode[] = [];
  let order = 0;
  root.querySelectorAll(SEMANTIC_TEXT_SELECTOR).forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!text || text.length < 5) return;

    let type: NodeType = "paragraph";
    const metadata: StructuredNode["metadata"] = {};

    if (/^h[1-6]$/.test(tag)) {
      type = "heading";
      metadata.level = parseInt(tag[1]!, 10);
    } else if (tag === "pre") {
      type = "code_block";
    } else if (tag === "blockquote") {
      type = "blockquote";
    } else if (tag === "li") {
      type = "list_item";
      metadata.list_style =
        el.parentElement?.tagName.toLowerCase() === "ol" ? "ordered" : "unordered";
    } else if (tag === "td" || tag === "th") {
      type = "table";
    }

    nodes.push({
      id: `node-${order}`,
      type,
      text,
      order: order++,
      parent_id: null,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  });
  return nodes;
}

export function extractPageMetadata(doc: Document = document): {
  title: string;
  author?: string;
  faviconUrl?: string;
  thumbnailUrl?: string;
} {
  const ogTitle = doc.querySelector<HTMLMetaElement>("meta[property='og:title']")?.content;
  const title = (ogTitle || doc.title || "Untitled Page").trim();

  const author =
    doc.querySelector<HTMLMetaElement>("meta[name='author']")?.content?.trim() ||
    doc.querySelector<HTMLMetaElement>("meta[property='article:author']")?.content?.trim() ||
    undefined;

  const faviconEl =
    doc.querySelector<HTMLLinkElement>("link[rel='icon']") ||
    doc.querySelector<HTMLLinkElement>("link[rel~='icon']");
  const ogImage = doc.querySelector<HTMLMetaElement>("meta[property='og:image']")?.content;

  return {
    title,
    author: author || undefined,
    faviconUrl: faviconEl?.href,
    thumbnailUrl: ogImage,
  };
}

function createLightweightDocument(): Document {
  const lightweight = document.implementation.createHTMLDocument(document.title || "Untitled");
  const sourceRoot = getExtractionRoot(document);
  const imported = lightweight.importNode(sourceRoot, true);
  stripNonContentNodes(imported);
  lightweight.body.appendChild(imported);
  return lightweight;
}

/**
 * Parse with Readability and return its HTML content (not textContent).
 * This preserves semantic structure for StructuredNode extraction.
 */
function parseWithReadability(doc: Document): {
  title?: string;
  contentHtml?: string;
  byline?: string;
} | null {
  const elementCount = doc.getElementsByTagName("*").length;
  if (elementCount > MAX_ELEMS_FOR_READABILITY) {
    return null;
  }

  try {
    const reader = new Readability(doc, {
      charThreshold: 80,
      nbTopCandidates: 3,
    });
    const article = reader.parse();
    if (!article) {
      return null;
    }
    return {
      title: article.title || undefined,
      contentHtml: article.content || undefined,  // HTML, not textContent
      byline: article.byline || undefined,
    };
  } catch {
    return null;
  }
}

export function captureWebpage(): WebpageCapturePayload | null {
  const started = performance.now();
  const metadata = extractPageMetadata(document);
  const liveCount = document.getElementsByTagName("*").length;
  const hasArticleRoot = Boolean(document.querySelector("article, main, [role='main']"));

  let title = metadata.title;
  let author = metadata.author;
  let nodes: StructuredNode[] = [];
  let extractionMethod: "readability" | "fallback_scraper" = "readability";

  if (!hasArticleRoot && liveCount > 4000) {
    // Very large page without semantic article root — use fallback scraper
    extractionMethod = "fallback_scraper";
    const root = document.body;
    stripNonContentNodes(root.cloneNode(true) as Element); // strip on clone
    nodes = extractFallbackNodes(document.body);
  } else {
    const lightweight = createLightweightDocument();
    const article = parseWithReadability(lightweight);

    if (article?.contentHtml) {
      title = article.title?.trim() || title;
      author = article.byline?.trim() || author;

      // Parse Readability's HTML output into a new document for structured walking
      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(article.contentHtml, "text/html");
      nodes = extractStructuredNodes(parsedDoc.body);

      // If Readability returned HTML but DOM walking yielded nothing — use fallback
      if (nodes.length === 0) {
        extractionMethod = "fallback_scraper";
        nodes = extractFallbackNodes(lightweight.body);
      }
    } else {
      // Readability failed — use fallback scraper
      extractionMethod = "fallback_scraper";
      nodes = extractFallbackNodes(lightweight.body);
    }
  }

  // Build flat plain-text content from structured nodes
  const rawContent = buildPlainTextFromNodes(nodes);
  const content = capExtractedContent(rawContent);

  if (!content || content.length < MIN_CONTENT_LENGTH) {
    return null;
  }

  const durationMs = Math.round(performance.now() - started);
  const status = extractionMethod === "readability" ? "success" : "partial";
  const { quality_score, quality_reasons } = scoreExtractionQuality(nodes, extractionMethod, status);

  return {
    source_type: "webpage",
    url: window.location.href,
    title,
    content,
    author,
    favicon_url: metadata.faviconUrl,
    thumbnail_url: metadata.thumbnailUrl,
    captured_at: new Date().toISOString(),
    structured_content: nodes,
    extraction: {
      method: extractionMethod,
      duration_ms: durationMs,
      status,
      quality_score,
      quality_reasons,
    },
  };
}

export function captureWebpageTimed(): WebpageExtractionResult | null {
  const started = performance.now();
  const payload = captureWebpage();
  if (!payload) {
    return null;
  }
  return {
    payload,
    extractionMs: Math.round(performance.now() - started),
  };
}
