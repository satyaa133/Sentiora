import type { CapturePayload, ExtensionMessage } from "../shared/types";

const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 1024;
const MAX_AUTHOR_LENGTH = 512;
const MAX_IMAGE_URL_LENGTH = 2048;
export const MAX_CONTENT_LENGTH = 80_000;

export function normalizeExtractedText(rawText: string): string {
  if (!rawText) return "";
  return rawText.replace(/\s+/g, " ").trim();
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

export function sanitizeCapturePayload(payload: CapturePayload): CapturePayload {
  const url = payload.url.slice(0, MAX_URL_LENGTH);
  const title = payload.title.trim().slice(0, MAX_TITLE_LENGTH);
  const content = capExtractedContent(normalizeExtractedText(payload.content ?? ""));

  if (payload.source_type === "webpage") {
    return {
      source_type: "webpage",
      url,
      title,
      content,
      author: payload.author?.slice(0, MAX_AUTHOR_LENGTH),
      favicon_url: payload.favicon_url?.slice(0, MAX_IMAGE_URL_LENGTH),
      thumbnail_url: payload.thumbnail_url?.slice(0, MAX_IMAGE_URL_LENGTH),
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
    };
  }

  return {
    source_type: "pdf",
    url,
    title,
    content,
    author: payload.author?.slice(0, MAX_AUTHOR_LENGTH),
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
