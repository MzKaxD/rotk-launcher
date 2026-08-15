import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaytimeStore } from "../electron/services/playtime-store.js";
import { elapsedSeconds, PlaytimeTracker } from "../electron/services/playtime-tracker.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rotk-playtime-tracker-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class FakeClock {
  ns = 0n;

  nowNs(): bigint {
    return this.ns;
  }

  advanceSeconds(seconds: number): void {
    this.ns += BigInt(seconds) * 1_000_000_000n;
  }
}

async function trackerHarness(initialSeconds = 0) {
  const directory = await temporaryDirectory();
  const store = new PlaytimeStore(directory);
  if (initialSeconds > 0) await store.save(initialSeconds);
  const clock = new FakeClock();
  const tracker = new PlaytimeTracker(store, { clock, persistIntervalMs: 30_000 });
  await tracker.initialize();
  return { directory, store, clock, tracker };
}

describe("PlaytimeTracker", () => {
  it("starts at zero when no file exists", async () => {
    const { tracker } = await trackerHarness();
    expect(tracker.summary()).toEqual({ totalSeconds: 0, sessionActive: false });
  });

  it("loads an existing duration before any session", async () => {
    const { tracker } = await trackerHarness(7260);
    expect(tracker.summary()).toEqual({ totalSeconds: 7260, sessionActive: false });
  });

  it("adds a complete session once H1Z1 has started", async () => {
    const { directory, clock, tracker } = await trackerHarness(120);
    tracker.startSession();
    clock.advanceSeconds(65);
    await tracker.endSession();

    const persisted = JSON.parse(await readFile(join(directory, "playtime.v1.json"), "utf8"));
    expect(tracker.summary()).toEqual({ totalSeconds: 185, sessionActive: false });
    expect(persisted.totalSeconds).toBe(185);
  });

  it("does not count a second start or a second end of the same session", async () => {
    const { clock, tracker } = await trackerHarness();
    tracker.startSession();
    clock.advanceSeconds(40);
    tracker.startSession();
    clock.advanceSeconds(20);
    await tracker.endSession();
    await tracker.endSession();

    expect(tracker.displayedSeconds()).toBe(60);
    expect(tracker.isSessionActive()).toBe(false);
  });

  it("keeps a zero-duration session at the previous total", async () => {
    const { directory, tracker } = await trackerHarness(15);
    tracker.startSession();
    await tracker.endSession();

    const persisted = JSON.parse(await readFile(join(directory, "playtime.v1.json"), "utf8"));
    expect(tracker.displayedSeconds()).toBe(15);
    expect(persisted.totalSeconds).toBe(15);
  });

  it("never exposes a negative total when the clock moves backwards", async () => {
    const { tracker, clock } = await trackerHarness(8);
    tracker.startSession();
    clock.ns = -5_000_000_000n;
    expect(elapsedSeconds(0n, clock.nowNs())).toBe(0);
    expect(tracker.displayedSeconds()).toBe(8);
    await tracker.endSession();
    expect(tracker.displayedSeconds()).toBe(8);
  });

  it("checkpoints a live session so a crash does not lose the whole duration", async () => {
    const { directory, clock, tracker } = await trackerHarness();
    tracker.startSession();
    clock.advanceSeconds(90);
    await tracker.checkpoint();

    const persisted = JSON.parse(await readFile(join(directory, "playtime.v1.json"), "utf8"));
    expect(persisted.totalSeconds).toBe(90);
    expect(tracker.summary()).toEqual({ totalSeconds: 90, sessionActive: true });

    clock.advanceSeconds(30);
    await tracker.endSession();
    expect(tracker.displayedSeconds()).toBe(120);
  });

  it("does not double-count time already absorbed by a checkpoint", async () => {
    const { clock, tracker } = await trackerHarness();
    tracker.startSession();
    clock.advanceSeconds(50);
    await tracker.checkpoint();
    await tracker.checkpoint();
    await tracker.endSession();
    expect(tracker.displayedSeconds()).toBe(50);
  });

  it("does not count time before startSession (install, prepare, launch)", async () => {
    const { clock, tracker } = await trackerHarness();
    clock.advanceSeconds(180);
    expect(tracker.displayedSeconds()).toBe(0);
    tracker.startSession();
    clock.advanceSeconds(12);
    expect(tracker.displayedSeconds()).toBe(12);
    tracker.dispose();
    await tracker.endSession();
  });

  it("treats a save failure as non-blocking", async () => {
    const { tracker, store, clock } = await trackerHarness();
    vi.spyOn(store, "save").mockRejectedValueOnce(new Error("disk full"));
    tracker.startSession();
    clock.advanceSeconds(25);
    await expect(tracker.endSession()).resolves.toBeUndefined();
    expect(tracker.displayedSeconds()).toBe(25);
  });
});
