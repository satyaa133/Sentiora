import * as PDFJS from "pdfjs-dist";
import type { StructuredNode } from "../types/memory";

// Initialize the PDF.js worker
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
PDFJS.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export async function parsePdf(data: ArrayBuffer): Promise<StructuredNode[] | null> {
  try {
    const loadingTask = PDFJS.getDocument({
      data: new Uint8Array(data),
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
          } as any);
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
  } catch (err) {
    console.error("[Sentiora] Frontend PDF parsing failed:", err);
    return null;
  }
}
