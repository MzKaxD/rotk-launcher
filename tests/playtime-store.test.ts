import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  emptyPlaytime,
  parsePlaytimeRecord,
  PlaytimeStore,
} from "../electron/services/playtime-store.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rotk-playtime-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("PlaytimeStore", () => {
  it("starts at zero on first use and writes the versioned file", async () => {
    const directory = await temporaryDirectory();
    const loaded = await new PlaytimeStore(directory).load();
    const persisted = JSON.parse(await readFile(join(directory, "playtime.v1.json"), "utf8"));

    expect(loaded).toEqual({ schemaVersion: 1, totalSeconds: 0 });
    expect(persisted).toEqual(emptyPlaytime());
  });

  it("reloads an existing duration", async () => {
    const directory = await temporaryDirectory();
    await new PlaytimeStore(directory).save(7260);

    const reloaded = await new PlaytimeStore(directory).load();
    expect(reloaded).toEqual({ schemaVersion: 1, totalSeconds: 7260 });
  });

  it("recovers to zero when the file is missing or corrupt", async () => {
    const missingDirectory = await temporaryDirectory();
    expect(await new PlaytimeStore(missingDirectory).load()).toEqual(emptyPlaytime());

    const corruptDirectory = await temporaryDirectory();
    await writeFile(join(corruptDirectory, "playtime.v1.json"), "{broken", "utf8");
    const recovered = await new PlaytimeStore(corruptDirectory).load();
    const persisted = JSON.parse(await readFile(join(corruptDirectory, "playtime.v1.json"), "utf8"));

    expect(recovered).toEqual(emptyPlaytime());
    expect(persisted).toEqual(emptyPlaytime());
  });

  it("rejects negative, non-finite and otherwise invalid records", () => {
    expect(parsePlaytimeRecord({ schemaVersion: 1, totalSeconds: -1 })).toBeNull();
    expect(parsePlaytimeRecord({ schemaVersion: 1, totalSeconds: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parsePlaytimeRecord({ schemaVersion: 1, totalSeconds: Number.NaN })).toBeNull();
    expect(parsePlaytimeRecord({ schemaVersion: 1, totalSeconds: 1.5 })).toBeNull();
    expect(parsePlaytimeRecord({ schemaVersion: 1, totalSeconds: "12" })).toBeNull();
    expect(parsePlaytimeRecord({ schemaVersion: 2, totalSeconds: 12 })).toBeNull();
    expect(parsePlaytimeRecord({ totalSeconds: 12 })).toBeNull();
  });

  it("recovers a persisted negative or invalid file instead of trusting it", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "playtime.v1.json"), JSON.stringify({
      schemaVersion: 1,
      totalSeconds: -40,
    }), "utf8");

    const recovered = await new PlaytimeStore(directory).load();
    expect(recovered.totalSeconds).toBe(0);
    expect(recovered.totalSeconds).toBeGreaterThanOrEqual(0);
  });

  it("writes atomically and leaves no temporary file behind", async () => {
    const directory = await temporaryDirectory();
    const store = new PlaytimeStore(directory);
    await store.save(3600);
    await store.save(7200);

    const files = await readdir(directory);
    const persisted = JSON.parse(await readFile(join(directory, "playtime.v1.json"), "utf8"));

    expect(files).toEqual(["playtime.v1.json"]);
    expect(persisted).toEqual({ schemaVersion: 1, totalSeconds: 7200 });
    expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
  });

  it("never persists a negative total", async () => {
    const directory = await temporaryDirectory();
    await new PlaytimeStore(directory).save(-90);
    const persisted = JSON.parse(await readFile(join(directory, "playtime.v1.json"), "utf8"));
    expect(persisted.totalSeconds).toBe(0);
  });
});
