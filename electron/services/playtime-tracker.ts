import type { PlaytimeSummary } from "../../shared/contracts.js";
import { clampPlaytimeSeconds, PlaytimeStore } from "./playtime-store.js";

export const DEFAULT_PLAYTIME_PERSIST_INTERVAL_MS = 30_000;

export interface PlaytimeClock {
  nowNs(): bigint;
}

export const hrtimeClock: PlaytimeClock = {
  nowNs: () => process.hrtime.bigint(),
};

export interface PlaytimeTrackerOptions {
  clock?: PlaytimeClock;
  persistIntervalMs?: number;
  onChange?: () => void;
}

interface ActiveSession {
  startedNs: bigint;
  accountedSeconds: number;
}

export function elapsedSeconds(startNs: bigint, nowNs: bigint): number {
  if (nowNs <= startNs) return 0;
  const asNumber = Number((nowNs - startNs) / 1_000_000_000n);
  return clampPlaytimeSeconds(asNumber);
}

/**
 * Counts only H1Z1 sessions spawned by the launcher. Uses a monotonic clock so
 * a Windows time change cannot inflate or rewind the total.
 */
export class PlaytimeTracker {
  private committedSeconds = 0;
  private session: ActiveSession | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  private readonly clock: PlaytimeClock;
  private readonly persistIntervalMs: number;
  private readonly onChange?: () => void;

  constructor(
    private readonly store: PlaytimeStore,
    options: PlaytimeTrackerOptions = {},
  ) {
    this.clock = options.clock ?? hrtimeClock;
    this.persistIntervalMs = options.persistIntervalMs ?? DEFAULT_PLAYTIME_PERSIST_INTERVAL_MS;
    this.onChange = options.onChange;
  }

  async initialize(): Promise<void> {
    try {
      this.committedSeconds = (await this.store.load()).totalSeconds;
    } catch (error) {
      console.warn("Playtime could not be loaded", error);
      this.committedSeconds = 0;
    }
  }

  summary(): PlaytimeSummary {
    return {
      totalSeconds: this.displayedSeconds(),
      sessionActive: this.session !== null,
    };
  }

  displayedSeconds(): number {
    return this.committedSeconds + this.unaccountedSeconds();
  }

  isSessionActive(): boolean {
    return this.session !== null;
  }

  /** Begin counting after H1Z1.exe has actually been spawned. */
  startSession(): void {
    if (this.session) return;
    this.session = { startedNs: this.clock.nowNs(), accountedSeconds: 0 };
    this.timer = setInterval(() => {
      void this.checkpoint();
    }, this.persistIntervalMs);
    this.timer.unref?.();
  }

  async endSession(): Promise<void> {
    if (!this.session) return;
    this.clearTimer();
    this.absorbSession();
    this.session = null;
    await this.persistCommitted();
    this.onChange?.();
  }

  async checkpoint(): Promise<void> {
    if (!this.session) return;
    this.absorbSession();
    await this.persistCommitted();
    this.onChange?.();
  }

  dispose(): void {
    this.clearTimer();
  }

  private unaccountedSeconds(): number {
    if (!this.session) return 0;
    const elapsed = elapsedSeconds(this.session.startedNs, this.clock.nowNs());
    const extra = elapsed - this.session.accountedSeconds;
    return extra > 0 ? extra : 0;
  }

  private absorbSession(): void {
    if (!this.session) return;
    const extra = this.unaccountedSeconds();
    if (extra <= 0) return;
    this.committedSeconds += extra;
    this.session.accountedSeconds += extra;
  }

  private async persistCommitted(): Promise<void> {
    this.persistQueue = this.persistQueue.then(async () => {
      try {
        await this.store.save(this.committedSeconds);
      } catch (error) {
        console.warn("Playtime could not be saved", error);
      }
    });
    await this.persistQueue;
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
