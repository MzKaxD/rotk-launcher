import { describe, expect, it, vi } from "vitest";
import { RUNTIME_CONFIGS } from "../electron/services/runtime-config.js";
import {
  fetchOperatorSessions,
  operatorBansEndpoint,
  operatorSessionsEndpoint,
  parseOperatorSessions,
  submitOperatorIpBan,
} from "../electron/services/operator-sessions.js";

const KEY = "0123456789abcdef0123456789abcdef";

describe("operator sessions API", () => {
  it("pins operator routes to the selected account-service origin", () => {
    expect(operatorSessionsEndpoint(RUNTIME_CONFIGS.game2).href).toBe(
      "https://rotk.app/api/launcher/operator/sessions",
    );
    expect(operatorBansEndpoint(RUNTIME_CONFIGS.test).href).toBe(
      "https://test.rotk.app/api/launcher/operator/bans",
    );
    expect(operatorSessionsEndpoint(RUNTIME_CONFIGS.game2).href).not.toContain("test.rotk.app");
  });

  it("accepts moderator sessions without carrying secrets", () => {
    const parsed = parseOperatorSessions({
      ok: true,
      role: "moderator",
      sessions: [{
        name: "Jin",
        loginSessionId: "sess-1",
        ip: "203.0.113.10",
        at: "2026-08-17T15:00:00.000Z",
      }],
      bans: [{ ip: "198.51.100.8", reason: "cheat", at: "2026-08-17T14:00:00.000Z", active: true }],
    });
    expect(parsed.status).toBe("ok");
    expect(parsed.role).toBe("moderator");
    expect(parsed.sessions[0]).toEqual({
      name: "Jin",
      loginSessionId: "sess-1",
      ip: "203.0.113.10",
      at: "2026-08-17T15:00:00.000Z",
    });
    expect(JSON.stringify(parsed)).not.toContain(KEY);
  });

  it("treats a missing route as unavailable so a player launcher still works", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch;
    const feed = await fetchOperatorSessions(RUNTIME_CONFIGS.game2, KEY, { fetchImpl });
    expect(feed.status).toBe("unavailable");
    expect(feed.sessions).toEqual([]);
    expect(feed.error).toMatch(/does not offer operator sessions/i);
  });

  it("does not show IPs when the account is not a moderator", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 403 })) as typeof fetch;
    const feed = await fetchOperatorSessions(RUNTIME_CONFIGS.game2, KEY, { fetchImpl });
    expect(feed.status).toBe("forbidden");
    expect(feed.sessions).toEqual([]);
    expect(feed.error).toMatch(/not a moderator/i);
  });

  it("posts the launcher key in the body, never in the URL", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe("https://rotk.app/api/launcher/operator/sessions");
      expect(String(input)).not.toContain(KEY);
      expect(JSON.parse(String(init?.body))).toEqual({ launcherKey: KEY, launcherVersion: "1.4.2" });
      return new Response(JSON.stringify({ ok: true, role: "admin", sessions: [], bans: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const feed = await fetchOperatorSessions(RUNTIME_CONFIGS.game2, KEY, {
      fetchImpl,
      launcherVersion: "1.4.2",
    });
    expect(feed.status).toBe("ok");
    expect(feed.role).toBe("admin");
  });

  it("submits a remote IP ban with the same launcher key", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe("https://rotk.app/api/launcher/operator/bans");
      expect(JSON.parse(String(init?.body))).toEqual({
        launcherKey: KEY,
        ip: "203.0.113.10",
        reason: "cheat",
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    await expect(submitOperatorIpBan(RUNTIME_CONFIGS.game2, KEY, "203.0.113.10", "cheat", { fetchImpl }))
      .resolves.toEqual({ ok: true, status: "ok" });
  });
});
