// PDF capture using pdfjs-dist (legacy / main-thread build).
// The legacy build avoids Web Worker requirements, making it compatible with
// Manifest V3 content scripts bundled as IIFE without worker URL setup.

import {
  capExtractedContent,
  buildPlainTextFromNodes,
  scoreExtractionQuality,
} from "../shared/captureUtils";
import type { PdfCapturePayload, StructuredNode } from "../shared/types";

// ──────────────────────────────────────────────
// Lazy-load pdfjs-dist to keep the bundle split manageable
// ──────────────────────────────────────────────
let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function getPdfJs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsLib) {
    // Dynamic import — Vite will bundle this at build time
    pdfjsLib = await import("pdfjs-dist");
    // Disable worker for Manifest V3 content-script context
    // (GlobalWorkerOptions.workerSrc = "" uses main-thread fallback)
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";
  }
  return pdfjsLib;
}

export function isPdfDocument(): boolean {
  const url = window.location.href.toLowerCase();
  return (
    url.endsWith(".pdf") ||
    document.contentType === "application/pdf" ||
    document.querySelector("embed[type='application/pdf']") !== null
  );
}

/**
 * Extract text from a PDF at the given URL using PDF.js.
 * Returns page-aware StructuredNode[] or null on failure.
 */
async function extractPdfNodes(url: string): Promise<StructuredNode[] | null> {
  try {
    const pdfjs = await getPdfJs();

    const loadingTask = pdfjs.getDocument({
      url,
      // Disable range requests to avoid CORS issues in extension context
      disableRange: true,
      disableStream: true,
    });

    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    const nodes: StructuredNode[] = [];
    let order = 0;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Accumulate text items per page; items within same line are joined
      const lineBuffer: string[] = [];
      let lastY: number | null = null;
      const Y_THRESHOLD = 2; // points tolerance for same-line grouping

      for (const item of textContent.items) {
        // PDF.js text items have `str` and transform[5] (y position)
        const textItem = item as { str: string; transform: number[] };
        const text = textItem.str;
        if (!text?.trim()) continue;

        const y: number = textItem.transform[5] ?? 0;
        if (lastY !== null && Math.abs(y - lastY) > Y_THRESHOLD) {
          // New line — flush buffer
          const line = lineBuffer.join(" ").trim();
          if (line.length >= 3) {
            nodes.push({
              id: `node-${order}`,
              type: "paragraph",
              text: line,
              order: order++,
              parent_id: null,
              metadata: { page_number: pageNum },
            });
          }
          lineBuffer.length = 0;
        }
        lineBuffer.push(text);
        lastY = y;
      }

      // Flush remaining buffer for the last line of the page
      const lastLine = lineBuffer.join(" ").trim();
      if (lastLine.length >= 3) {
        nodes.push({
          id: `node-${order}`,
          type: "paragraph",
          text: lastLine,
          order: order++,
          parent_id: null,
          metadata: { page_number: pageNum },
        });
      }
    }

    return nodes.length > 0 ? nodes : null;
  } catch {
    return null;
  }
}

export async function capturePdf(isForce = false): Promise<PdfCapturePayload | null> {
  const started = performance.now();
  const url = window.location.href.slice(0, 2048);

  // Extract title from filename or document title
  let title = document.title;
  if (!title || title === url || title.endsWith(".pdf")) {
    const filename = url.split("/").pop()?.split("?")[0] || "Document.pdf";
    title = decodeURIComponent(filename);
  }
  title = title.trim().slice(0, 1024);

  // ── Extract via PDF.js ─────────────────────────
  const nodes = await extractPdfNodes(url);

  // ── No meaningful content → do NOT fabricate ─────
  if (!nodes || nodes.length === 0) {
    return null;
  }

  const rawContent = buildPlainTextFromNodes(nodes);
  const content = capExtractedContent(rawContent);

  if (!content || content.length < 10) {
    return null;
  }

  const durationMs = Math.round(performance.now() - started);
  const { quality_score, quality_reasons } = scoreExtractionQuality(
    nodes,
    "pdf_js",
    "success",
  );

  return {
    source_type: "pdf",
    url,
    title,
    content,
    captured_at: new Date().toISOString(),
    structured_content: nodes,
    extraction: {
      method: "pdf_js",
      duration_ms: durationMs,
      status: "success",
      quality_score,
      quality_reasons,
    },
    is_force: isForce,
  };
}
