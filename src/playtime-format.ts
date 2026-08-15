/** Whole hours and minutes, stable enough for the footer. Seconds stay out of view. */
export function formatPlaytimeHours(totalSeconds: number): string {
  const seconds = sanitizeDisplayedPlaytime(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours} h ${minutes.toString().padStart(2, "0")}`;
}

export function sanitizeDisplayedPlaytime(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}
