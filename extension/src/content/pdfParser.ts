import type * as PDFJS from "pdfjs-dist";
import type { StructuredNode, CaptureErrorCode } from "../shared/types";

let pdfjsLib: typeof PDFJS | null = null;

async function getPdfJs(): Promise<typeof PDFJS> {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    // In a Chrome MV3 content script (IIFE bundle), Web Workers cannot be
    // spawned from inline blob: URLs due to CSP. The worker file must be a
    // static extension asset referenced by chrome.runtime.getURL().
    // We copy pdf.worker.min.mjs into dist/ at build time (see vite.config.ts).
    const workerSrc = (typeof chrome !== "undefined" && chrome.runtime?.getURL)
      ? chrome.runtime.getURL("pdf.worker.min.mjs")
      : new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  }
  return pdfjsLib;
}

function throwError(code: CaptureErrorCode, message: string): never {
  const err = new Error(message) as any;
  err.code = code;
  throw err;
}

export async function extractPdfNodesFromData(data: Uint8Array): Promise<StructuredNode[]> {
  let pdf;
  try {
    const pdfjs = await getPdfJs();
    const loadingTask = pdfjs.getDocument({
      data,
      disableRange: true,
      disableStream: true,
    });
    pdf = await loadingTask.promise;
  } catch (err: any) {
    throwError("PDF_INVALID", err.message || "Failed to parse PDF document.");
  }

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
    
    // Safety limit to prevent memory exhaustion
    if (nodes.length > 5000) break;
  }

  if (nodes.length === 0) {
    throwError("PDF_NO_TEXT", "This PDF appears to be scanned or contains no selectable text.");
  }

  return nodes.slice(0, 5000);
}
