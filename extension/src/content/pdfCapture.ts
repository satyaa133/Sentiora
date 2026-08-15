import {
  capExtractedContent,
  buildPlainTextFromNodes,
  scoreExtractionQuality,
} from "../shared/captureUtils";
import type { PdfCapturePayload, StructuredNode } from "../shared/types";

import type * as PDFJS from "pdfjs-dist";

let pdfjsLib: typeof PDFJS | null = null;

async function getPdfJs(): Promise<typeof PDFJS> {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";
  }
  return pdfjsLib;
}

export function isPdfDocument(): boolean {
  const url = window.location.href.toLowerCase();
  return (
    url.endsWith(".pdf") ||
    url.includes(".pdf?") ||
    document.contentType === "application/pdf" ||
    document.querySelector("embed[type='application/pdf']") !== null ||
    document.querySelector("embed[src*='.pdf']") !== null
  );
}

export function extractTextLayerNodes(root: Document | Element = document): StructuredNode[] {
  const nodes: StructuredNode[] = [];
  let order = 0;

  const visit = (node: Document | Element | ShadowRoot, pageHint = 1) => {
    const layerPages = node.querySelectorAll?.(".textLayer") ?? [];
    if (layerPages.length > 0) {
      layerPages.forEach((layer, index) => {
        const pageNumber =
          Number((layer.closest("[data-page-number]") as HTMLElement | null)?.dataset.pageNumber) ||
          index + 1;
        const text = Array.from(layer.querySelectorAll("span, div"))
          .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
          .filter((part) => part.length >= 2)
          .join(" ")
          .trim();
        if (text.length >= 8) {
          nodes.push({
            id: `node-${order}`,
            type: "paragraph",
            text,
            order: order++,
            parent_id: null,
            metadata: { page_number: pageNumber },
          });
        }
      });
    }

    const elements = "querySelectorAll" in node ? node.querySelectorAll("*") : [];
    elements.forEach((el) => {
      const shadow = (el as HTMLElement).shadowRoot;
      if (shadow) visit(shadow, pageHint);
    });
  };

  visit(root);
  return nodes;
}

function pdfSourceUrl(): string {
  const embed = document.querySelector("embed[type='application/pdf'], embed[src*='.pdf']") as HTMLEmbedElement | null;
  if (embed?.src) return embed.src;
  return window.location.href;
}

async function fetchPdfBytes(url: string): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(url);
    if (resp.ok) {
      return new Uint8Array(await resp.arrayBuffer());
    }
  } catch {
    // Isolated-world fetch often fails for Chrome's PDF viewer and file:// URLs.
  }

  return await new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "FETCH_PDF_BYTES", url }, (response) => {
        if (chrome.runtime.lastError || !response?.success || !response.bytes) {
          resolve(null);
          return;
        }
        resolve(new Uint8Array(response.bytes as number[]));
      });
    } catch {
      resolve(null);
    }
  });
}

export async function extractPdfNodesFromData(data: Uint8Array): Promise<StructuredNode[] | null> {
  try {
    const pdfjs = await getPdfJs();
    const loadingTask = pdfjs.getDocument({
      data,
      disableRange: true,
      disableStream: true,
    });
    const pdf = await loadingTask.promise;
    const nodes: StructuredNode[] = [];
    let order = 0;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const lineBuffer: string[] = [];
      let lastY: number | null = null;
      const Y_THRESHOLD = 2;

      const flush = () => {
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
      };

      for (const item of textContent.items) {
        const textItem = item as { str: string; transform: number[] };
        const text = textItem.str;
        if (!text?.trim()) continue;
        const y: number = textItem.transform[5] ?? 0;
        if (lastY !== null && Math.abs(y - lastY) > Y_THRESHOLD) {
          flush();
        }
        lineBuffer.push(text);
        lastY = y;
      }
      flush();
    }

    return nodes.length > 0 ? nodes : null;
  } catch {
    return null;
  }
}

async function extractPdfNodes(url: string): Promise<StructuredNode[] | null> {
  const layerNodes = extractTextLayerNodes(document);
  if (layerNodes.length > 0) {
    return layerNodes;
  }

  const bytes = await fetchPdfBytes(url);
  if (bytes && bytes.byteLength > 0) {
    return extractPdfNodesFromData(bytes);
  }

  try {
    const pdfjs = await getPdfJs();
    const loadingTask = pdfjs.getDocument({
      url,
      disableRange: true,
      disableStream: true,
    });
    const pdf = await loadingTask.promise;
    const copy = await pdf.getData();
    return extractPdfNodesFromData(copy);
  } catch {
    return null;
  }
}

export async function capturePdf(isForce = false): Promise<PdfCapturePayload | null> {
  const started = performance.now();
  const url = pdfSourceUrl().slice(0, 2048);

  let title = document.title;
  if (!title || title === url || title.toLowerCase().endsWith(".pdf")) {
    const filename = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "Document.pdf");
    title = filename;
  }
  title = title.trim().slice(0, 1024);

  const nodes = await extractPdfNodes(url);
  if (!nodes || nodes.length === 0) {
    return null;
  }

  const rawContent = buildPlainTextFromNodes(nodes);
  const content = capExtractedContent(rawContent);
  if (!content || content.split(/\s+/).filter(Boolean).length < 12) {
    return null;
  }

  const durationMs = Math.round(performance.now() - started);
  const { quality_score, quality_reasons } = scoreExtractionQuality(nodes, "pdf_js", "success");

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
