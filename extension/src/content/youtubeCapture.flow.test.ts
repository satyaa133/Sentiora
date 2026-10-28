import { describe, expect, it, vi } from "vitest";
import {
  YoutubeCaptureError,
  captureYoutube,
  extractInlinePlayerResponse,
  extractVideoMetadata,
  parseTimestamp,
  pickCaptionTracks,
  readTranscriptPanel,
  type YoutubeCaptureDeps,
} from "./youtubeCapture";
import type { YoutubePlayerResponse } from "../shared/types";

const VIDEO_ID = "dQw4w9WgXcQ";
const WATCH = `https://www.youtube.com/watch?v=${VIDEO_ID}&t=42s&list=PL1`;
const CANONICAL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const TRACK_URL = "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en";

const LINES = [
  "welcome back today we look at how lighthouse keepers kept the lamps burning",
  "the keepers trimmed the wicks every four hours and polished the fresnel lens",
  "at zephyrine point the keeper logged nine gallons of whale oil a night in january",
  "when oil ran low the keeper switched to lard oil which burned dimmer",
];

function playerResponse(overrides: Partial<YoutubePlayerResponse> = {}): YoutubePlayerResponse {
  return {
    videoDetails: {
      videoId: VIDEO_ID,
      title: "Lighthouse Keepers of the 1800s",
      author: "Maritime History Channel",
      channelId: "UC123",
      lengthSeconds: "98",
      isLive: false,
      thumbnail: {
        thumbnails: [
          { url: "https://i.ytimg.com/vi/x/default.jpg", width: 120 },
          { url: "https://i.ytimg.com/vi/x/maxres.jpg", width: 1280 },
        ],
      },
    },
    playabilityStatus: { status: "OK" },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { baseUrl: `${TRACK_URL}&kind=asr`, languageCode: "en", kind: "asr" },
          { baseUrl: TRACK_URL, languageCode: "en" },
        ],
      },
    },
    ...overrides,
  };
}

function json3(): string {
  return JSON.stringify({
    events: LINES.map((line, i) => ({
      tStartMs: i * 20_000,
      dDurationMs: 19_500,
      segs: line.split(" ").map((w) => ({ utf8: `${w} ` })),
    })),
  });
}

function emptyDoc(): Document {
  return document.implementation.createHTMLDocument("Lighthouse Keepers - YouTube");
}

function deps(overrides: Partial<YoutubeCaptureDeps> = {}): Partial<YoutubeCaptureDeps> {
  return {
    href: WATCH,
    doc: emptyDoc(),
    requestPlayerResponse: async () => playerResponse(),
    fetchText: async () => json3(),
    sleep: async () => undefined,
    now: (() => {
      let t = 0;
      return () => (t += 100);
    })(),
    ...overrides,
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(YoutubeCaptureError);
  await expect(promise).rejects.toMatchObject({ code });
}

function panelDoc(rows: [string, string][]): Document {
  const doc = emptyDoc();
  for (const [stamp, text] of rows) {
    const seg = doc.createElement("ytd-transcript-segment-renderer");
    seg.innerHTML = `<div class="segment-timestamp"> ${stamp} </div><yt-formatted-string class="segment-text">${text}</yt-formatted-string>`;
    doc.body.appendChild(seg);
  }
  return doc;
}

describe("captureYoutube — success paths", () => {
  it("builds a canonical, timestamped transcript payload from caption tracks", async () => {
    const fetchText = vi.fn(async () => json3());
    const payload = await captureYoutube(false, deps({ fetchText }));

    expect(payload.source_type).toBe("youtube");
    expect(payload.url).toBe(CANONICAL);
    expect(payload.title).toBe("Lighthouse Keepers of the 1800s");
    expect(payload.author).toBe("Maritime History Channel");
    expect(payload.thumbnail_url).toBe("https://i.ytimg.com/vi/x/maxres.jpg");
    expect(payload.content).toContain("nine gallons of whale oil");
    expect(payload.extraction).toMatchObject({ method: "youtube_transcript", status: "success" });
    const nodes = payload.structured_content ?? [];
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes[0]?.metadata?.start_seconds).toBe(0);
    expect(nodes.at(-1)?.metadata?.end_seconds).toBeCloseTo(79.5, 1);
    // Manual track is preferred over auto-generated (asr), and json3 is requested.
    expect(fetchText).toHaveBeenCalledWith(`${TRACK_URL}&fmt=json3`);
  });

  it("supports Shorts URLs", async () => {
    const payload = await captureYoutube(false, deps({ href: `https://www.youtube.com/shorts/${VIDEO_ID}` }));
    expect(payload.url).toBe(CANONICAL);
  });

  it("falls back to XML captions when json3 is empty", async () => {
    const xml = `<transcript>${LINES.map((l, i) => `<text start="${i * 20}" dur="19.5">${l}</text>`).join("")}</transcript>`;
    const fetchText = vi.fn(async (url: string) => (url.includes("fmt=json3") ? null : xml));
    const payload = await captureYoutube(false, deps({ fetchText }));
    expect(payload.content).toContain("fresnel lens");
    expect(payload.structured_content?.[0]?.metadata?.start_seconds).toBe(0);
  });

  it("uses the inline ytInitialPlayerResponse when the main-world bridge is unavailable", async () => {
    const doc = emptyDoc();
    const script = doc.createElement("script");
    script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify(playerResponse())};var meta = {"a":"}"};`;
    doc.head.appendChild(script);
    const payload = await captureYoutube(false, deps({ doc, requestPlayerResponse: async () => null }));
    expect(payload.title).toBe("Lighthouse Keepers of the 1800s");
  });

  it("reads an already-open transcript panel when caption fetches return nothing (auto capture)", async () => {
    const doc = panelDoc(LINES.map((l, i) => [`0:${String(i * 20).padStart(2, "0")}`, l]));
    const payload = await captureYoutube(false, deps({ doc, fetchText: async () => null }));
    expect(payload.content).toContain("lard oil");
    expect(payload.extraction?.quality_reasons).toContain("transcript_from_panel");
    expect(payload.structured_content?.[0]?.metadata?.start_seconds).toBe(0);
  });

  it("opens the transcript panel only on manual capture", async () => {
    const doc = emptyDoc();
    const section = doc.createElement("ytd-video-description-transcript-section-renderer");
    const button = doc.createElement("button");
    button.addEventListener("click", () => {
      LINES.forEach((l, i) => {
        const seg = doc.createElement("ytd-transcript-segment-renderer");
        seg.innerHTML = `<div class="segment-timestamp">0:${String(i * 20).padStart(2, "0")}</div><div class="segment-text">${l}</div>`;
        doc.body.appendChild(seg);
      });
    });
    section.appendChild(button);
    doc.body.appendChild(section);
    const clickSpy = vi.spyOn(button, "click");

    await expectCode(captureYoutube(false, deps({ doc, fetchText: async () => null })), "YOUTUBE_TRANSCRIPT_FETCH_FAILED");
    expect(clickSpy).not.toHaveBeenCalled();

    const payload = await captureYoutube(true, deps({ doc, fetchText: async () => null }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(payload.content).toContain("whale oil");
    expect(payload.is_force).toBe(true);
  });
});

describe("captureYoutube — honest failures (nothing saved)", () => {
  it("reports captions unavailable with metadata found", async () => {
    const promise = captureYoutube(
      true,
      deps({ requestPlayerResponse: async () => playerResponse({ captions: undefined }) }),
    );
    await expectCode(promise, "YOUTUBE_CAPTIONS_UNAVAILABLE");
    await expect(promise).rejects.toThrow(/Lighthouse Keepers/);
  });

  it.each(["LOGIN_REQUIRED", "UNPLAYABLE", "ERROR", "AGE_CHECK_REQUIRED"])(
    "reports %s videos as unavailable",
    async (status) => {
      await expectCode(
        captureYoutube(true, deps({ requestPlayerResponse: async () => playerResponse({ playabilityStatus: { status } }) })),
        "YOUTUBE_VIDEO_UNAVAILABLE",
      );
    },
  );

  it("reports a loading player when no player data or transcript exists", async () => {
    await expectCode(
      captureYoutube(true, deps({ requestPlayerResponse: async () => null })),
      "YOUTUBE_PLAYER_UNREADY",
    );
  });

  it("reports a removed/invalid video as unavailable, not as a loading player", async () => {
    const doc = emptyDoc();
    const error = doc.createElement("yt-playability-error-supported-renderers");
    error.innerHTML = "<div>Video unavailable</div><div>This video is unavailable</div>";
    doc.body.appendChild(error);
    const promise = captureYoutube(true, deps({ doc, requestPlayerResponse: async () => null }));
    await expectCode(promise, "YOUTUBE_VIDEO_UNAVAILABLE");
    await expect(promise).rejects.toThrow(/Video unavailable/);
  });

  it("ignores YouTube's empty error-screen placeholder on playable pages", async () => {
    const doc = emptyDoc();
    doc.body.appendChild(doc.createElement("yt-playability-error-supported-renderers"));
    await expectCode(
      captureYoutube(true, deps({ doc, requestPlayerResponse: async () => null })),
      "YOUTUBE_PLAYER_UNREADY",
    );
  });

  it("reports fetch failure when captions exist but return nothing (network error)", async () => {
    await expectCode(captureYoutube(false, deps({ fetchText: async () => null })), "YOUTUBE_TRANSCRIPT_FETCH_FAILED");
  });

  it("treats malformed caption responses as fetch failures", async () => {
    await expectCode(
      captureYoutube(false, deps({ fetchText: async () => "<html>consent page</html>" })),
      "YOUTUBE_TRANSCRIPT_FETCH_FAILED",
    );
  });

  it("rejects transcripts too short to be meaningful", async () => {
    const tiny = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "[Music]" }] }] });
    await expectCode(captureYoutube(false, deps({ fetchText: async () => tiny })), "YOUTUBE_TRANSCRIPT_PARSE_FAILED");
  });

  it("rejects unsupported pages", async () => {
    await expectCode(
      captureYoutube(true, deps({ href: "https://www.youtube.com/results?search_query=x" })),
      "YOUTUBE_PLAYER_UNREADY",
    );
  });

  it("ignores player data for a different video (stale SPA state)", async () => {
    const other = playerResponse();
    other.videoDetails = { ...other.videoDetails, videoId: "AAAAAAAAAAA" };
    const doc = emptyDoc();
    const script = doc.createElement("script");
    script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify(other)};`;
    doc.head.appendChild(script);
    expect(extractInlinePlayerResponse(doc, VIDEO_ID)).toBeNull();
  });
});

describe("helpers", () => {
  it("parses transcript panel timestamps", () => {
    expect(parseTimestamp("0:05")).toBe(5);
    expect(parseTimestamp("12:34")).toBe(754);
    expect(parseTimestamp("1:02:03")).toBe(3723);
    expect(parseTimestamp("abc")).toBeNull();
  });

  it("orders panel segments and derives end times from the next segment and duration", () => {
    const doc = panelDoc([
      ["0:20", "second line of text"],
      ["0:00", "first line of text"],
    ]);
    expect(readTranscriptPanel(doc, 30)).toEqual([
      { text: "first line of text", start: 0, end: 20 },
      { text: "second line of text", start: 20, end: 30 },
    ]);
  });

  it("returns null for an empty panel", () => {
    expect(readTranscriptPanel(emptyDoc())).toBeNull();
  });

  it("prefers manual English, then other manual, then auto-generated tracks", () => {
    const ranked = pickCaptionTracks([
      { baseUrl: "a", languageCode: "en", kind: "asr" },
      { baseUrl: "b", languageCode: "de" },
      { baseUrl: "c", languageCode: "en-GB" },
    ]);
    expect(ranked.map((t) => t.baseUrl)).toEqual(["c", "b", "a"]);
  });

  it("falls back to DOM metadata and a default thumbnail", () => {
    const doc = emptyDoc();
    const meta = extractVideoMetadata(VIDEO_ID, null, doc);
    expect(meta.title).toBe("Lighthouse Keepers");
    expect(meta.thumbnailUrl).toBe(`https://img.youtube.com/vi/${VIDEO_ID}/hqdefault.jpg`);
    expect(meta.durationSeconds).toBeUndefined();
  });
});
