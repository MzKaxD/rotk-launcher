import { afterEach, describe, expect, it } from "vitest";
import {
  buildCreateSessionXml,
  startLocalSessionGateway,
  type LocalSessionGateway,
} from "../electron/services/session-gateway.js";

const launchTicket = "T".repeat(43);
const gateways: LocalSessionGateway[] = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
});

describe("loopback Steam create-session gateway", () => {
  it("returns the short in-memory ticket only from the exact loopback POST endpoint", async () => {
    const gateway = await startLocalSessionGateway(launchTicket);
    gateways.push(gateway);

    expect(gateway.createSessionUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/rest\/auth\/session\/create$/,
    );
    expect(gateway.createSessionUrl).not.toContain(launchTicket);

    const response = await fetch(gateway.createSessionUrl, { method: "POST" });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml;charset=UTF-8");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toBe(buildCreateSessionXml(launchTicket));
    expect(body).toContain(`<sessionid>${launchTicket}</sessionid>`);
  });

  it("rejects GET, query strings and browser-originated requests", async () => {
    const gateway = await startLocalSessionGateway(launchTicket);
    gateways.push(gateway);

    const getResponse = await fetch(gateway.createSessionUrl);
    const queryResponse = await fetch(`${gateway.createSessionUrl}?sessionid=${launchTicket}`, {
      method: "POST",
    });
    const originResponse = await fetch(gateway.createSessionUrl, {
      method: "POST",
      headers: { Origin: "http://untrusted.invalid" },
    });

    expect(getResponse.status).toBe(403);
    expect(queryResponse.status).toBe(403);
    expect(originResponse.status).toBe(403);
  });
});
