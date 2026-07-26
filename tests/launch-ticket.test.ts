import { describe, expect, it, vi } from "vitest";
import {
  assertLaunchTicketFresh,
  createLaunchTicket,
  launchTicketInternals,
} from "../electron/services/launch-ticket.js";

const launcherKey = "0123456789abcdef0123456789abcdef";
const endpoint = "https://accounts.rotk.app/createLaunchTicket";
const authorityIssuedAtMs = Date.now();

function validTicketResponse(lifetimeMs = 120_000) {
  return {
    ok: true,
    ticket: "T".repeat(43),
    issuedAt: new Date(authorityIssuedAtMs).toISOString(),
    expiresAt: new Date(authorityIssuedAtMs + lifetimeMs).toISOString(),
    rotkId: "123e4567-e89b-42d3-a456-426614174000",
    gameAccountGuid: "9223372036854775807",
    steamId: "76561198000000001",
    displayName: "ROTK Player",
  };
}

const validResponse = validTicketResponse();

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ROTK launch ticket client", () => {
  it("sends the durable key only in the HTTPS JSON body and validates the identity", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(input.toString()).toBe(endpoint);
      expect(input.toString()).not.toContain(launcherKey);
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
      expect(init?.body).toBe(JSON.stringify({ launcherKey }));
      return jsonResponse(validResponse);
    }) as typeof fetch;

    const identity = await createLaunchTicket(launcherKey, endpoint, { fetchImpl });
    expect(identity).toMatchObject({
      ticket: validResponse.ticket,
      issuedAt: validResponse.issuedAt,
      expiresAt: validResponse.expiresAt,
      rotkId: validResponse.rotkId,
      gameAccountGuid: validResponse.gameAccountGuid,
      steamId: validResponse.steamId,
      displayName: validResponse.displayName,
    });
    expect(identity.receivedAtMonotonicMs).toBeGreaterThanOrEqual(0);
    expect(identity.initialRemainingLifetimeMs).toBeGreaterThan(110_000);
    expect(identity.initialRemainingLifetimeMs).toBeLessThanOrEqual(120_000);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not reject a valid authority window when the workstation wall clock is wrong", async () => {
    const wallClock = vi.spyOn(Date, "now").mockReturnValue(authorityIssuedAtMs + 24 * 60 * 60_000);
    const fetchImpl = vi.fn(async () => jsonResponse(validResponse)) as typeof fetch;
    try {
      await expect(createLaunchTicket(launcherKey, endpoint, { fetchImpl }))
        .resolves.toMatchObject({ ticket: validResponse.ticket });
    } finally {
      wallClock.mockRestore();
    }
  });

  it("tracks freshness from authority lifetime plus monotonic elapsed time", () => {
    const identity = launchTicketInternals.parseTicketResponse(validResponse, {
      requestStartedAtMonotonicMs: 1_000,
      receivedAtMonotonicMs: 1_100,
    });
    expect(identity.initialRemainingLifetimeMs).toBe(119_900);
    expect(() => assertLaunchTicketFresh(identity, 10_000, 110_999)).not.toThrow();
    expect(() => assertLaunchTicketFresh(identity, 10_000, 111_000))
      .toThrow("The ROTK launch ticket expires too soon");
  });

  it("fails closed when the key is rejected", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      ok: false,
      error: "invalid_credentials",
      message: "Invalid launcher key",
    }, 401)) as typeof fetch;

    await expect(createLaunchTicket(launcherKey, endpoint, { fetchImpl }))
      .rejects.toThrow("The ROTK launcher key was rejected");
  });

  it("rejects malformed identity data even after HTTP 200", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      ...validResponse,
      steamId: "not-a-steam-id",
    })) as typeof fetch;

    await expect(createLaunchTicket(launcherKey, endpoint, { fetchImpl }))
      .rejects.toThrow("Invalid response from the ROTK account service");
  });

  it("rejects a server-issued ticket window with less than ten seconds", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(validTicketResponse(5_000))) as typeof fetch;

    await expect(createLaunchTicket(launcherKey, endpoint, { fetchImpl }))
      .rejects.toThrow("The ROTK launch ticket expires too soon");
  });

  it("rejects malformed or implausibly long authority windows", () => {
    expect(() => launchTicketInternals.parseTicketResponse({
      ...validResponse,
      issuedAt: "not-a-date",
    })).toThrow("Invalid response from the ROTK account service");
    expect(() => launchTicketInternals.parseTicketResponse({
      ...validResponse,
      issuedAt: validResponse.issuedAt.replace("Z", "+00:00"),
    })).toThrow("Invalid response from the ROTK account service");
    expect(() => launchTicketInternals.parseTicketResponse(validTicketResponse(11 * 60_000)))
      .toThrow("Invalid response from the ROTK account service");
  });

  it("requires an HTTPS endpoint without query parameters", async () => {
    await expect(createLaunchTicket(launcherKey, `${endpoint}?key=bad`))
      .rejects.toThrow("Invalid ROTK launch ticket endpoint");
  });
});