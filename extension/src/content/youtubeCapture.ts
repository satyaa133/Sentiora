import { capExtractedContent, normalizeExtractedText } from "../shared/captureUtils";
import type { YoutubeCapturePayload } from "../shared/types";

export function isYoutubeWatchPage(): boolean {
  return (
    window.location.hostname.includes("youtube.com") &&
    window.location.pathname === "/watch" &&
    new URLSearchParams(window.location.search).has("v")
  );
}

export async function captureYoutube(): Promise<YoutubeCapturePayload | null> {
  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get("v");
  if (!videoId) return null;

  // Extract video title from DOM
  const titleEl =
    document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
    document.querySelector("h1.title ytd-formatted-string") ||
    document.querySelector("meta[name='title']");

  const title = titleEl
    ? (titleEl as HTMLElement).innerText || (titleEl as HTMLMetaElement).content || "YouTube Video"
    : document.title;

  // Extract channel / author
  const authorEl =
    document.querySelector("#owner #channel-name a") ||
    document.querySelector("ytd-channel-name a");

  const author = authorEl ? (authorEl as HTMLElement).innerText.trim() : undefined;

  // Extract thumbnail
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  let content = "";
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 2500);
    const transcriptResp = await fetch(
      `https://www.youtube.com/api/timedtext?lang=en&v=${videoId}`,
      { signal: controller.signal },
    );
    window.clearTimeout(timeoutId);
    if (transcriptResp.ok) {
      const xmlText = await transcriptResp.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      const textNodes = xmlDoc.getElementsByTagName("text");
      const lines: string[] = [];
      for (let i = 0; i < textNodes.length; i++) {
        const node = textNodes[i];
        if (node?.textContent) {
          const line = node.textContent.trim();
          if (line) lines.push(line);
        }
      }
      content = lines.join(" ");
    }
  } catch {
    // Timedtext is optional; fall back to the visible description.
  }

  // Fallback to description if no transcript available
  if (!content) {
    const descriptionEl =
      document.querySelector("#description-inline-expander") ||
      document.querySelector("#description") ||
      document.querySelector("meta[name='description']");

    if (descriptionEl) {
      content =
        (descriptionEl as HTMLElement).innerText ||
        (descriptionEl as HTMLMetaElement).content ||
        "";
    }
  }

  if (!content || content.length < 10) {
    content = `YouTube video titled '${title}' by ${author || "unknown channel"}.`;
  }

  return {
    source_type: "youtube",
    url: window.location.href,
    title: title.trim(),
    content: capExtractedContent(normalizeExtractedText(content)),
    author,
    thumbnail_url: thumbnailUrl,
  };
}
