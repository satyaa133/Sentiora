/**
 * Opt-in live check against a real, public YouTube video. Skipped (reported as
 * "skipped", never "passed") unless SENTIORA_LIVE_YOUTUBE=1 is set:
 *
 *   SENTIORA_LIVE_YOUTUBE=1 npx vitest run src/content/youtubeCapture.live.test.ts
 *
 * Optionally set SENTIORA_LIVE_YOUTUBE_VIDEO_ID (default: a public video with
 * captions). It runs the extension's own parsers on the live page: inline
 * player response → caption tracks → timedtext → transcript segments. It does
 * not exercise the main-world bridge or the transcript panel, which need a
 * real Chrome extension context.
 */
import { describe, expect, it } from "vitest";
import {
  extractInlinePlayerResponse,
  parseCaptionTracks,
  parseTimedTextJson3,
  parseTimedTextXml,
  pickCaptionTracks,
} from "./youtubeCapture";

const LIVE = process.env.SENTIORA_LIVE_YOUTUBE === "1";
const VIDEO_ID = process.env.SENTIORA_LIVE_YOUTUBE_VIDEO_ID ?? "aircAruvnKk";

describe.skipIf(!LIVE)("live YouTube transcript extraction (opt-in)", () => {
  it(
    "finds player metadata and caption tracks, and reports whether timedtext is accessible",
    async () => {
      const html = await (
        await fetch(`https://www.youtube.com/watch?v=${VIDEO_ID}&hl=en`, {
          headers: { "Accept-Language": "en-US,en;q=0.9" },
        })
      ).text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const player = extractInlinePlayerResponse(doc, VIDEO_ID);
      expect(player?.videoDetails?.videoId).toBe(VIDEO_ID);
      expect(player?.videoDetails?.title).toBeTruthy();

      const tracks = pickCaptionTracks(parseCaptionTracks(player));
      expect(tracks.length).toBeGreaterThan(0);

      const track = tracks[0]!;
      const raw = await (await fetch(`${track.baseUrl}&fmt=json3`)).text();
      const segments = raw.trim() ? (parseTimedTextJson3(raw) ?? parseTimedTextXml(raw)) : null;
      // YouTube may require a proof-of-origin token for timedtext outside a real
      // player session; in that case the extension falls back to the transcript
      // panel. Report it explicitly rather than pretending it worked.
      console.info(
        `[live] ${VIDEO_ID}: ${tracks.length} track(s); timedtext ${
          segments ? `returned ${segments.length} segments` : "returned no data (likely needs a player session/pot token)"
        }`,
      );
      if (segments) {
        expect(segments[0]!.start).toBeGreaterThanOrEqual(0);
        expect(segments.map((s) => s.text).join(" ").split(/\s+/).length).toBeGreaterThan(50);
      }
    },
    30_000,
  );
});
