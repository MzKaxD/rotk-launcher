import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PublishedUpdate } from "../../shared/contracts.js";
import { WEBSITE_ORIGIN } from "../constants.js";

const FIRESTORE_QUERY_URL =
  "https://firestore.googleapis.com/v1/projects/rotk-project/databases/(default)/documents:runQuery";
const MAX_FEED_BYTES = 1_000_000;

interface FirestoreValue {
  stringValue?: string;
  timestampValue?: string;
  nullValue?: null;
}

interface FirestoreQueryRow {
  document?: {
    name?: string;
    fields?: Record<string, FirestoreValue>;
  };
}

function readString(fields: Record<string, FirestoreValue>, key: string): string {
  return fields[key]?.stringValue?.trim() ?? "";
}

function normalizeCoverImage(value: string): string {
  try {
    const url = new URL(value, WEBSITE_ORIGIN);
    if (url.protocol === "https:" && url.origin === WEBSITE_ORIGIN) return url.href;
  } catch {
    // Invalid remote image: the renderer will use its branded fallback.
  }
  return "";
}

function parseRows(value: unknown): PublishedUpdate[] {
  if (!Array.isArray(value)) throw new Error("Unexpected Firestore response");
  const updates: PublishedUpdate[] = [];

  for (const row of value as FirestoreQueryRow[]) {
    const fields = row.document?.fields;
    const name = row.document?.name;
    if (!fields || !name) continue;
    const id = name.split("/").at(-1) ?? "";
    const type = readString(fields, "type");
    const title = readString(fields, "title");
    const publishedAt = fields.publishedAt?.timestampValue ?? "";
    if (
      !id ||
      !title ||
      !publishedAt ||
      !Number.isFinite(Date.parse(publishedAt)) ||
      (type !== "dev" && type !== "patch")
    ) {
      continue;
    }

    updates.push({
      id,
      type,
      title: title.slice(0, 120),
      summary: readString(fields, "summary").slice(0, 360),
      version: readString(fields, "version") || null,
      category: readString(fields, "category").slice(0, 64),
      coverImageUrl: normalizeCoverImage(readString(fields, "coverImage")),
      publishedAt,
      siteUrl: `${WEBSITE_ORIGIN}/updates/${encodeURIComponent(id)}`,
    });
  }

  return updates
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, 2);
}

function isCachedUpdate(value: unknown): value is PublishedUpdate {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PublishedUpdate>;
  return (
    typeof item.id === "string" &&
    (item.type === "dev" || item.type === "patch") &&
    typeof item.title === "string" &&
    typeof item.summary === "string" &&
    typeof item.publishedAt === "string" &&
    typeof item.siteUrl === "string" &&
    item.siteUrl.startsWith(`${WEBSITE_ORIGIN}/updates/`)
  );
}

export class UpdateFeedService {
  private readonly cachePath: string;

  constructor(userDataDirectory: string) {
    this.cachePath = join(userDataDirectory, "updates-cache.v1.json");
  }

  async getLatest(): Promise<PublishedUpdate[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7_000);
      let response: Response;
      try {
        response = await fetch(FIRESTORE_QUERY_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: "publishedUpdates" }],
              orderBy: [{ field: { fieldPath: "publishedAt" }, direction: "DESCENDING" }],
              limit: 2,
            },
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_FEED_BYTES) throw new Error("Feed too large");
      const updates = parseRows(JSON.parse(body));
      if (updates.length === 0) throw new Error("Feed empty");
      await this.writeCache(updates);
      return updates;
    } catch {
      return this.readCache();
    }
  }

  private async readCache(): Promise<PublishedUpdate[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.cachePath, "utf8"));
      return Array.isArray(parsed) ? parsed.filter(isCachedUpdate).slice(0, 2) : [];
    } catch {
      return [];
    }
  }

  private async writeCache(updates: PublishedUpdate[]): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true });
    const temporary = `${this.cachePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(updates, null, 2)}\n`, "utf8");
    await rename(temporary, this.cachePath);
  }
}

export const updateFeedInternals = {
  parseRows,
  normalizeCoverImage,
  queryUrl: FIRESTORE_QUERY_URL,
};
