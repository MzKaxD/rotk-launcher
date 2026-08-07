import { describe, expect, it, vi } from "vitest";
import { RUNTIME_CONFIGS } from "../electron/services/runtime-config.js";
import {
  UNKNOWN_SERVER_STATUS,
  fetchServerStatus,
  parseServerStatus,
  statusEndpoint,
} from "../electron/services/server-status.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("server status", () => {
  it("reads the population from each server's own HTTPS origin", () => {
    expect(statusEndpoint(RUNTIME_CONFIGS.game2).href).toBe("https://rotk.app/api/status");
    expect(statusEndpoint(RUNTIME_CONFIGS.test).href).toBe("https://test.rotk.app/api/status");
  });

  it("accepts a well-formed count and its optional capacity", () => {
    expect(parseServerStatus({ players: 42, capacity: 150, online: true })).toEqual({
      players: 42,
      capacity: 150,
      online: true,
    });
    expect(parseServerStatus({ players: 0, capacity: null, online: true })).toEqual({
      players: 0,
      capacity: null,
      online: true,
    });
  });

  it("reports unknown rather than a confident zero when the count is unusable", () => {
    // A server that says "online" without a number must not render as empty.
    expect(parseServerStatus({ players: null, capacity: 150, online: true }).online).toBe(false);
    for (const players of [-1, 1.5, "12", Number.NaN, 1_000_000]) {
      const status = parseServerStatus({ players, capacity: null, online: true });
      expect(status.players).toBeNull();
      expect(status.online).toBe(false);
    }
  });

  it("refuses a payload that is not a status", () => {
    expect(() => parseServerStatus(null)).toThrow(/server status/);
    expect(() => parseServerStatus({ players: 3 })).toThrow(/server status/);
  });

  it("answers unknown instead of failing when a server is unreachable", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(fetchServerStatus(RUNTIME_CONFIGS.game2, { fetchImpl: failing as never }))
      .resolves.toEqual(UNKNOWN_SERVER_STATUS);

    const refusing = vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 503));
    await expect(fetchServerStatus(RUNTIME_CONFIGS.game2, { fetchImpl: refusing as never }))
      .resolves.toEqual(UNKNOWN_SERVER_STATUS);

    const garbage = vi.fn().mockResolvedValue(jsonResponse({ players: "many", online: true }));
    await expect(fetchServerStatus(RUNTIME_CONFIGS.game2, { fetchImpl: garbage as never }))
      .resolves.toMatchObject({ players: null, online: false });
  });

  it("never follows a redirect away from the server it asked", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ players: 8, capacity: 150, online: true }));

    await expect(fetchServerStatus(RUNTIME_CONFIGS.test, { fetchImpl: fetchImpl as never }))
      .resolves.toEqual({ players: 8, capacity: 150, online: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://test.rotk.app/api/status");
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
  });
});
