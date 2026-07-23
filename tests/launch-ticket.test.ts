import { describe, expect, it, vi } from "vitest";
import { createLaunchTicket } from "../electron/services/launch-ticket.js";

const launcherKey = "0123456789abcdef0123456789abcdef";
const endpoint = "https://accounts.rotk.app/createLaunchTicket";
const validResponse = {
  ok: true,
  ticket: "T".repeat(43),
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  rotkId: "123e4567-e89b-42d3-a456-426614174000",
  gameAccountGuid: "9223372036854775807",
  steamId: "76561198000000001",
  displayName: "ROTK Player",
};

describe("ROTK launch ticket client", () => {
  it("sends the durable key only in the HTTPS JSON body and validates the identity", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(input.toString()).toBe(endpoint);
      expect(input.toString()).not.toContain(launcherKey);
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
      expect(init?.body).toBe(JSON.stringify({ launcherKey }));
      return new Response(JSON.stringify(validResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await expect(createLaunchTicket(launcherKey, endpoint, { fetchImpl })).resolves.toEqual({
      ticket: validResponse.ticket,
      expiresAt: validResponse.expiresAt,
      rotkId: validResponse.rotkId,
      gameAccountGuid: validResponse.gameAccountGuid,
      steamId: validResponse.steamId,
      displayName: validResponse.displayName,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails closed when the key is rejected", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: "invalid_credentials",
      message: "Invalid launcher key",
    }), { status: 401 })) as typeof fetch;

    await expect(createLaunchTicket(launcherKey, endpoint, { fetchImpl }))
      .rejects.toThrow("The ROTK launcher key was rejected");
  });

  it("rejects malformed identity data even after HTTP 200", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ...validResponse,
      steamId: "not-a-steam-id",
    }), { status: 200 })) as typeof fetch;

    await expect(createLaunchTicket(launcherKey, endpoint, { fetchImpl }))
      .rejects.toThrow("Invalid response from the ROTK account service");
  });

  it("rejects a valid-looking ticket when less than ten seconds remain", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ...validResponse,
      expiresAt: new Date(Date.now() + 5_000).toISOString(),
    }), { status: 200 })) as typeof fetch;

    await expect(createLaunchTicket(launcherKey, endpoint, { fetchImpl }))
      .rejects.toThrow("The ROTK launch ticket expires too soon");
  });

  it("requires an HTTPS endpoint without query parameters", async () => {
    await expect(createLaunchTicket(launcherKey, `${endpoint}?key=bad`))
      .rejects.toThrow("Invalid ROTK launch ticket endpoint");
  });
});
