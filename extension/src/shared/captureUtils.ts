import type {
  CapturePayload,
  ExtensionMessage,
  StructuredNode,
  ExtractionMetadata,
  ExtractionStatus,
  ExtractionMethod,
} from "../shared/types";

const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 1024;
const MAX_AUTHOR_LENGTH = 512;
const MAX_IMAGE_URL_LENGTH = 2048;
export const MAX_CONTENT_LENGTH = 80_000;

export function normalizeExtractedText(rawText: string): string {
  if (!rawText) return "";
  return rawText
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function capExtractedContent(text: string, maxLength = MAX_CONTENT_LENGTH): string {
  if (text.length <= maxLength) {
    return text;
  }

  const sliced = text.slice(0, maxLength);
  const lastBreak = Math.max(sliced.lastIndexOf(". "), sliced.lastIndexOf("\n"), sliced.lastIndexOf(" "));
  const cutoff = lastBreak > maxLength * 0.8 ? lastBreak + 1 : maxLength;
  return sliced.slice(0, cutoff).trim();
}

/**
 * Joins StructuredNode[] into a normalized plain-text string suitable for
 * the backend `content` field. Code blocks preserve internal whitespace.
 */
export function buildPlainTextFromNodes(nodes: StructuredNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    const text = node.text.trim();
    if (!text) continue;
    if (node.type === "heading") {
      const prefix = "#".repeat(node.metadata?.level ?? 1);
      parts.push(`${prefix} ${text}`);
    } else if (node.type === "list_item") {
      const bullet = node.metadata?.list_style === "ordered" ? "-" : "•";
      parts.push(`${bullet} ${text}`);
    } else if (node.type === "code_block") {
      const lang = node.metadata?.language ?? "";
      parts.push(`\`\`\`${lang}\n${node.text}\n\`\`\``);
    } else {
      parts.push(text);
    }
  }
  return parts.join("\n\n").trim();
}

/**
 * Lightweight client-side quality heuristic. Produces a 0.0–1.0 score
 * with explanatory reasons. Does NOT make length the only signal.
 */
export function scoreExtractionQuality(
  nodes: StructuredNode[],
  method: ExtractionMethod,
  status: ExtractionStatus,
): Pick<ExtractionMetadata, "quality_score" | "quality_reasons"> {
  const reasons: string[] = [];

  if (status === "failed" || status === "insufficient_content") {
    return { quality_score: 0.0, quality_reasons: [status] };
  }

  if (status === "partial") {
    reasons.push("partial_content");
  }

  const meaningfulNodes = nodes.filter((n) => n.text.trim().length > 10);
  const headingCount = nodes.filter((n) => n.type === "heading").length;
  const codeCount = nodes.filter((n) => n.type === "code_block").length;
  const listCount = nodes.filter((n) => n.type === "list_item").length;
  const tableCount = nodes.filter((n) => n.type === "table").length;
  const totalChars = nodes.reduce((acc, n) => acc + n.text.length, 0);

  let score = 0.0;

  // Node volume (up to 0.35)
  if (meaningfulNodes.length >= 20) {
    score += 0.35;
    reasons.push("rich_node_count");
  } else if (meaningfulNodes.length >= 8) {
    score += 0.20;
    reasons.push("adequate_node_count");
  } else if (meaningfulNodes.length >= 3) {
    score += 0.10;
    reasons.push("minimal_node_count");
  }

  // Meaningful text volume (up to 0.25)
  if (totalChars >= 3000) {
    score += 0.25;
    reasons.push("substantial_text_length");
  } else if (totalChars >= 800) {
    score += 0.15;
    reasons.push("adequate_text_length");
  } else if (totalChars >= 200) {
    score += 0.05;
    reasons.push("short_but_present");
  }

  // Structure signals (up to 0.25)
  if (headingCount >= 2) {
    score += 0.10;
    reasons.push("meaningful_headings");
  } else if (headingCount === 1) {
    score += 0.05;
    reasons.push("single_heading");
  }

  if (codeCount >= 1) {
    score += 0.10;
    reasons.push("code_present");
  }

  if (listCount >= 3) {
    score += 0.05;
    reasons.push("lists_present");
  }

  if (tableCount >= 1) {
    score += 0.05;
    reasons.push("table_present");
  }

  // Method quality bonus (up to 0.15)
  if (method === "readability" && status === "success") {
    score += 0.15;
    reasons.push("readability_success");
  } else if (method === "youtube_transcript" && status === "success") {
    score += 0.15;
    reasons.push("transcript_success");
  } else if (method === "pdf_js" && status === "success") {
    score += 0.10;
    reasons.push("pdf_js_success");
  } else if (method === "fallback_scraper") {
    score += 0.05;
    reasons.push("fallback_used");
  }

  return {
    quality_score: Math.min(1.0, Math.round(score * 100) / 100),
    quality_reasons: reasons,
  };
}

export function sanitizeCapturePayload(payload: CapturePayload): CapturePayload {
  const url = payload.url.slice(0, MAX_URL_LENGTH);
  const title = payload.title.trim().slice(0, MAX_TITLE_LENGTH);
  const content = capExtractedContent(normalizeExtractedText(payload.content ?? ""));

  // Shared v2 fields
  const captured_at = payload.captured_at;
  const structured_content = payload.structured_content;
  const extraction = payload.extraction;

  if (payload.source_type === "webpage") {
    return {
      source_type: "webpage",
      url,
      title,
      content,
      author: payload.author?.slice(0, MAX_AUTHOR_LENGTH),
      favicon_url: payload.favicon_url?.slice(0, MAX_IMAGE_URL_LENGTH),
      thumbnail_url: payload.thumbnail_url?.slice(0, MAX_IMAGE_URL_LENGTH),
      captured_at,
      structured_content,
      extraction,
    };
  }

  if (payload.source_type === "youtube") {
    return {
      source_type: "youtube",
      url,
      title,
      content,
      author: payload.author?.slice(0, MAX_AUTHOR_LENGTH),
      thumbnail_url: payload.thumbnail_url?.slice(0, MAX_IMAGE_URL_LENGTH),
      captured_at,
      structured_content,
      extraction,
    };
  }

  return {
    source_type: "pdf",
    url,
    title,
    content,
    author: payload.author?.slice(0, MAX_AUTHOR_LENGTH),
    captured_at,
    structured_content,
    extraction,
  };
}

export interface CapturePostResult {
  success: boolean;
  deduplicated?: boolean;
  error?: string;
}

export async function postCapturePayload(
  postFn: (payload: CapturePayload) => Promise<unknown>,
  payload: CapturePayload,
): Promise<CapturePostResult> {
  if (!payload.url?.trim() || !payload.title?.trim()) {
    return { success: false, error: "Missing required capture fields." };
  }

  if (!payload.content || payload.content.trim().length < 10) {
    return { success: false, error: "Insufficient content to save." };
  }

  try {
    await postFn(sanitizeCapturePayload(payload));
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Capture request failed.";
    return { success: false, error: message };
  }
}

export function sendCaptureMessage(
  message: ExtensionMessage,
): Promise<CapturePostResult> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          success: false,
          error: chrome.runtime.lastError.message ?? "Background worker unavailable.",
        });
        return;
      }

      if (!response) {
        resolve({ success: false, error: "No response from background worker." });
        return;
      }

      resolve({
        success: Boolean(response.success),
        deduplicated: Boolean(response.deduplicated),
        error: response.error ? String(response.error) : undefined,
      });
    });
  });
}
