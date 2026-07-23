import { describe, expect, it } from "vitest";
import { updateFeedInternals } from "../electron/services/update-feed.js";

function row(
  id: string,
  fields: Record<string, { stringValue?: string; timestampValue?: string }>,
): unknown {
  return {
    document: {
      name: `projects/rotk-project/databases/(default)/documents/publishedUpdates/${id}`,
      fields,
    },
  };
}

describe("ROTK update feed parsing", () => {
  it("uses the public read-only endpoint without embedding an API key", () => {
    const url = new URL(updateFeedInternals.queryUrl);
    expect(url.origin).toBe("https://firestore.googleapis.com");
    expect(url.pathname).toContain("/projects/rotk-project/");
    expect(url.search).toBe("");
  });

  it("keeps only the two newest supported publications", () => {
    const parsed = updateFeedInternals.parseRows([
      row("old-patch", {
        type: { stringValue: "patch" },
        title: { stringValue: "Old patch" },
        summary: { stringValue: "Older" },
        publishedAt: { timestampValue: "2026-07-15T10:00:00.000Z" },
      }),
      row("latest-dev", {
        type: { stringValue: "dev" },
        title: { stringValue: "Latest dev update" },
        summary: { stringValue: "Newest" },
        coverImage: { stringValue: "https://rotk.app/images/atv-run.jpg" },
        publishedAt: { timestampValue: "2026-07-17T13:53:00.000Z" },
      }),
      row("middle-patch", {
        type: { stringValue: "patch" },
        title: { stringValue: "Middle patch" },
        version: { stringValue: "1.0.0" },
        publishedAt: { timestampValue: "2026-07-17T13:12:00.000Z" },
      }),
      row("ignored-news", {
        type: { stringValue: "news" },
        title: { stringValue: "Unsupported" },
        publishedAt: { timestampValue: "2026-07-18T00:00:00.000Z" },
      }),
      row("invalid-date", {
        type: { stringValue: "dev" },
        title: { stringValue: "Malformed publication" },
        publishedAt: { timestampValue: "not-a-date" },
      }),
    ]);

    expect(parsed.map((item) => item.id)).toEqual(["latest-dev", "middle-patch"]);
    expect(parsed[0].siteUrl).toBe("https://rotk.app/updates/latest-dev");
    expect(parsed[0].coverImageUrl).toBe("https://rotk.app/images/atv-run.jpg");
  });

  it("does not allow third-party or insecure cover images", () => {
    expect(updateFeedInternals.normalizeCoverImage("https://evil.example/image.jpg")).toBe("");
    expect(updateFeedInternals.normalizeCoverImage("http://rotk.app/image.jpg")).toBe("");
    expect(updateFeedInternals.normalizeCoverImage("/images/fireline.jpg")).toBe(
      "https://rotk.app/images/fireline.jpg",
    );
  });

  it("bounds text and URL-encodes Firestore document ids", () => {
    const parsed = updateFeedInternals.parseRows([
      row("dev update #1", {
        type: { stringValue: "dev" },
        title: { stringValue: "T".repeat(200) },
        summary: { stringValue: "S".repeat(500) },
        category: { stringValue: "C".repeat(100) },
        publishedAt: { timestampValue: "2026-07-17T13:53:00.000Z" },
      }),
    ]);

    expect(parsed[0].title).toHaveLength(120);
    expect(parsed[0].summary).toHaveLength(360);
    expect(parsed[0].category).toHaveLength(64);
    expect(parsed[0].siteUrl).toBe("https://rotk.app/updates/dev%20update%20%231");
  });
});
