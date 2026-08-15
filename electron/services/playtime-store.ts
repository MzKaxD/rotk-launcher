import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const PLAYTIME_FILE_NAME = "playtime.v1.json";
export const PLAYTIME_SCHEMA_VERSION = 1 as const;

export interface PlaytimeRecord {
  schemaVersion: typeof PLAYTIME_SCHEMA_VERSION;
  totalSeconds: number;
}

export function emptyPlaytime(): PlaytimeRecord {
  return { schemaVersion: PLAYTIME_SCHEMA_VERSION, totalSeconds: 0 };
}

export function isValidPlaytimeSeconds(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && Number.isFinite(value)
    && value >= 0
    && value <= Number.MAX_SAFE_INTEGER;
}

export function parsePlaytimeRecord(value: unknown): PlaytimeRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { schemaVersion?: unknown; totalSeconds?: unknown };
  if (candidate.schemaVersion !== PLAYTIME_SCHEMA_VERSION) return null;
  if (!isValidPlaytimeSeconds(candidate.totalSeconds)) return null;
  return { schemaVersion: PLAYTIME_SCHEMA_VERSION, totalSeconds: candidate.totalSeconds };
}

export function clampPlaytimeSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

/**
 * Local, versioned play-time file. A corrupt or missing file resets to zero
 * without throwing: this counter must never block the launcher or a launch.
 */
export class PlaytimeStore {
  private readonly path: string;
  private record: PlaytimeRecord | null = null;

  constructor(userDataDirectory: string) {
    this.path = join(userDataDirectory, PLAYTIME_FILE_NAME);
  }

  filePath(): string {
    return this.path;
  }

  async load(): Promise<PlaytimeRecord> {
    if (this.record) return this.record;

    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      const valid = parsePlaytimeRecord(parsed);
      if (valid) {
        this.record = valid;
        return valid;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
        console.warn("Playtime file could not be read", error);
      }
    }

    this.record = emptyPlaytime();
    try {
      await this.writeAtomic(this.record);
    } catch (error) {
      console.warn("Playtime file could not be initialized", error);
    }
    return this.record;
  }

  async save(totalSeconds: number): Promise<void> {
    const next: PlaytimeRecord = {
      schemaVersion: PLAYTIME_SCHEMA_VERSION,
      totalSeconds: clampPlaytimeSeconds(totalSeconds),
    };
    await this.writeAtomic(next);
    this.record = next;
  }

  private async writeAtomic(next: PlaytimeRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporaryPath, this.path);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
