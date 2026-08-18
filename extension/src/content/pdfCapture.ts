import {
  capExtractedContent,
  buildPlainTextFromNodes,
  scoreExtractionQuality,
} from "../shared/captureUtils";
import type { PdfCapturePayload, StructuredNode, CaptureErrorCode } from "../shared/types";
import { extractPdfNodesFromData } from "./pdfParser";

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

function throwError(code: CaptureErrorCode, message: string): never {
  const err = new Error(message) as any;
  err.code = code;
  throw err;
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

function checkFileAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "CHECK_FILE_ACCESS" }, (response) => {
        if (chrome.runtime.lastError || !response) resolve(false);
        else resolve(!!response.isAllowed);
      });
    } catch {
      resolve(false);
    }
  });
}

async function fetchFileViaXhr(url: string): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 0) {
        if (xhr.response) resolve(new Uint8Array(xhr.response));
        else resolve(null);
      } else {
        resolve(null);
      }
    };
    xhr.onerror = () => resolve(null);
    try {
      xhr.send();
    } catch {
      resolve(null);
    }
  });
}

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const isLocalFile = url.startsWith("file://");
  
  if (isLocalFile) {
    const isAllowed = await checkFileAccess();
    if (!isAllowed) {
      throwError(
        "PDF_FILE_ACCESS_DENIED", 
        "Extension does not have access to file URLs. Please enable 'Allow access to file URLs' in the Sentiora extension settings."
      );
    }

    // Try XHR first for file:/// URLs
    const xhrBytes = await fetchFileViaXhr(url);
    if (xhrBytes && xhrBytes.length > 0) return xhrBytes;
  }

  try {
    const resp = await fetch(url);
    if (resp.ok) {
      const buf = await resp.arrayBuffer();
      if (buf.byteLength > 0) return new Uint8Array(buf);
    }
  } catch {
    // Fall back to background worker
  }

  // Fallback to background worker
  const bgBytes = await new Promise<Uint8Array | null>((resolve) => {
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

  if (!bgBytes || bgBytes.length === 0) {
    throwError("PDF_BYTES_UNAVAILABLE", "Could not obtain PDF bytes from the document or network.");
  }

  return bgBytes;
}



async function extractPdfNodes(url: string): Promise<StructuredNode[]> {
  const layerNodes = extractTextLayerNodes(document);
  if (layerNodes.length > 10) {
    return layerNodes.slice(0, 5000);
  }

  const bytes = await fetchPdfBytes(url);
  return extractPdfNodesFromData(bytes);
}

export async function capturePdf(isForce = false): Promise<PdfCapturePayload> {
  const started = performance.now();
  const url = pdfSourceUrl().slice(0, 2048);

  let title = document.title;
  if (!title || title === url || title.toLowerCase().endsWith(".pdf")) {
    const filename = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "Document.pdf");
    title = filename;
  }
  title = title.trim().slice(0, 1024);

  const nodes = await extractPdfNodes(url);
  let rawContent = buildPlainTextFromNodes(nodes);
  
  if (rawContent.length > 500_000) {
    rawContent = rawContent.slice(0, 500_000);
  }

  const content = capExtractedContent(rawContent);

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
