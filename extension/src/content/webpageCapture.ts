import { Readability } from "@mozilla/readability";
import type { WebpageCapturePayload } from "../shared/types";
import { capExtractedContent, normalizeExtractedText } from "../shared/captureUtils";

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

export function stripNonContentNodes(root: ParentNode): void {
  root.querySelectorAll(JUNK_SELECTOR).forEach((node) => node.remove());
}

export function extractSemanticText(root: ParentNode): string {
  const parts: string[] = [];
  root.querySelectorAll(SEMANTIC_TEXT_SELECTOR).forEach((node) => {
    const text = node.textContent?.replace(/\s+/g, " ").trim();
    if (text) {
      parts.push(text);
    }
  });
  return parts.join("\n\n");
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

  const faviconEl = doc.querySelector<HTMLLinkElement>("link[rel='icon']") ||
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

function parseWithReadability(doc: Document): { title?: string; content?: string; byline?: string } | null {
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
      content: article.textContent || undefined,
      byline: article.byline || undefined,
    };
  } catch {
    return null;
  }
}

export function captureWebpage(): WebpageCapturePayload | null {
  const metadata = extractPageMetadata(document);
  const liveCount = document.getElementsByTagName("*").length;
  const hasArticleRoot = Boolean(document.querySelector("article, main, [role='main']"));

  let title = metadata.title;
  let author = metadata.author;
  let rawContent = "";

  if (!hasArticleRoot && liveCount > 4000) {
    rawContent = extractSemanticText(document.body);
  } else {
    const lightweight = createLightweightDocument();
    const article = parseWithReadability(lightweight);
    if (article?.content) {
      title = article.title?.trim() || title;
      author = article.byline?.trim() || author;
      rawContent = article.content;
    } else {
      rawContent = extractSemanticText(lightweight.body);
    }
  }

  const content = capExtractedContent(normalizeExtractedText(rawContent));
  if (!content || content.length < 50) {
    return null;
  }

  return {
    source_type: "webpage",
    url: window.location.href,
    title,
    content,
    author,
    favicon_url: metadata.faviconUrl,
    thumbnail_url: metadata.thumbnailUrl,
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
