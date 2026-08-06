import type { PdfCapturePayload } from "../shared/types";

export function isPdfDocument(): boolean {
  const url = window.location.href.toLowerCase();
  return (
    url.endsWith(".pdf") ||
    document.contentType === "application/pdf" ||
    document.querySelector("embed[type='application/pdf']") !== null
  );
}

export function capturePdf(): PdfCapturePayload | null {
  const url = window.location.href;

  // Extract title from filename or document title
  let title = document.title;
  if (!title || title === url || title.endsWith(".pdf")) {
    const filename = url.split("/").pop()?.split("?")[0] || "Document.pdf";
    title = decodeURIComponent(filename);
  }

  // Chrome's built-in PDF viewer renders text layer inside #viewer or shadowRoot
  let content = "";
  const pdfViewer = document.querySelector("#viewerContainer") || document.querySelector("embed");
  if (pdfViewer) {
    content = (pdfViewer as HTMLElement).innerText || "";
  }

  if (!content) {
    content = document.body ? document.body.innerText : "";
  }

  content = content.replace(/\s+/g, " ").trim();

  if (!content || content.length < 10) {
    content = `PDF document titled '${title}' captured from ${url}.`;
  }

  return {
    source_type: "pdf",
    url,
    title,
    content,
  };
}
