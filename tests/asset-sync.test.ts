import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AssetSyncService,
  parseAssetManifest,
  type AssetManifest,
  type AssetManifestEntry,
} from "../electron/services/asset-sync.js";
import { buildZip } from "./helpers/build-zip.js";

const FEED_URL = "https://raw.githubusercontent.com/rotk/rotk-assets/main/feed.json";
const INSTALL_MARKER_NAME = ".rotk-installation.json";

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function assetEntry(
  name: string,
  payload: Buffer,
  overrides: Partial<AssetManifestEntry> = {},
): AssetManifestEntry {
  return {
    name,
    version: "1.0.0",
    url: `https://github.com/rotk/rotk-assets/releases/download/assets-v1.0.0/${name}`,
    sha256: sha256(payload),
    size: payload.length,
    installPath: name,
    type: "file",
    ...overrides,
  };
}

function manifest(assets: AssetManifestEntry[], packVersion = "1.0.0"): AssetManifest {
  return { manifestVersion: 1, packVersion, assets };
}

type RouteHandler = () => Response;

function makeFetch(routes: Record<string, RouteHandler>, calls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const handler = routes[url];
    if (!handler) throw new Error(`Unrouted fetch: ${url}`);
    return handler();
  }) as typeof fetch;
}

describe("ROTK asset sync", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  async function setup(): Promise<{ userData: string; root: string }> {
    const userData = await mkdtemp(join(tmpdir(), "rotk-asset-userdata-"));
    const root = await mkdtemp(join(tmpdir(), "rotk-asset-client-"));
    temporaryDirectories.push(userData, root);
    await writeFile(join(root, INSTALL_MARKER_NAME), "{}\n");
    return { userData, root };
  }

  function service(
    userData: string,
    routes: Record<string, RouteHandler>,
    calls: string[] = [],
  ): AssetSyncService {
    return new AssetSyncService({
      userDataDirectory: userData,
      feedUrl: FEED_URL,
      fetchImpl: makeFetch(routes, calls),
    });
  }

  describe("manifest validation", () => {
    const payload = Buffer.from("payload");

    function withEntry(overrides: Partial<AssetManifestEntry>): AssetManifest {
      return manifest([assetEntry("pack.dat", payload, overrides)]);
    }

    it("accepts a valid manifest and normalizes the zip root", () => {
      const parsed = parseAssetManifest(manifest([
        assetEntry("ui-pack.zip", payload, { type: "zip", installPath: "." }),
        assetEntry("sounds.pack", payload, { installPath: "Resources/Assets/sounds.pack" }),
      ]));
      expect(parsed.assets[0].installPath).toBe(".");
      expect(parsed.assets[1].installPath).toBe("Resources/Assets/sounds.pack");
    });

    it("rejects insecure or third-party download URLs", () => {
      expect(() => parseAssetManifest(withEntry({ url: "http://github.com/x" }))).toThrow("URL invalide");
      expect(() => parseAssetManifest(withEntry({ url: "https://evil.example/x" }))).toThrow("hôte non autorisé");
      expect(() => parseAssetManifest(withEntry({ url: "https://user:pw@github.com/x" }))).toThrow("URL invalide");
    });

    it("rejects install paths escaping or targeting protected files", () => {
      expect(() => parseAssetManifest(withEntry({ installPath: "../outside.dat" }))).toThrow("chemin non autorisé");
      expect(() => parseAssetManifest(withEntry({ installPath: "C:/absolute.dat" }))).toThrow("chemin non autorisé");
      expect(() => parseAssetManifest(withEntry({ installPath: "a\\b.dat" }))).toThrow("chemin non autorisé");
      expect(() => parseAssetManifest(withEntry({ installPath: "mod.dll" }))).toThrow("extension interdite");
      expect(() => parseAssetManifest(withEntry({ installPath: "tool.exe" }))).toThrow("extension interdite");
      expect(() => parseAssetManifest(withEntry({ installPath: "ClientConfig.ini" }))).toThrow("fichier protégé");
      expect(() => parseAssetManifest(withEntry({ installPath: ".rotk-installation.json" }))).toThrow("fichier protégé");
      expect(() => parseAssetManifest(withEntry({ installPath: "BattlEye/config.cfg" }))).toThrow("chemin non autorisé");
      expect(() => parseAssetManifest(withEntry({ installPath: "steam_api64.original.dll" }))).toThrow("chemin non autorisé");
    });

    it("rejects duplicate assets, bad hashes and bad sizes", () => {
      const duplicated = manifest([assetEntry("a.dat", payload), assetEntry("a.dat", payload)]);
      expect(() => parseAssetManifest(duplicated)).toThrow("asset en double");
      expect(() => parseAssetManifest(withEntry({ sha256: "beef" }))).toThrow("sha256 invalide");
      expect(() => parseAssetManifest(withEntry({ size: 0 }))).toThrow("taille invalide");
      expect(() => parseAssetManifest(withEntry({ size: 4 * 1024 ** 4 }))).toThrow("taille invalide");
    });
  });

  it("installs file and zip assets, backs up originals and keeps state", async () => {
    const { userData, root } = await setup();
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "sounds.pack"), "vanilla sounds");

    const soundsPayload = Buffer.from("custom sounds");
    const zipPayload = buildZip([
      { name: "Resources/", directory: true },
      { name: "Resources/texture.dat", data: "custom texture", method: 8 },
    ]);
    const feed = manifest([
      assetEntry("rotk-sounds", soundsPayload, { installPath: "data/sounds.pack" }),
      assetEntry("rotk-ui", zipPayload, { type: "zip", installPath: "." }),
    ]);
    const calls: string[] = [];
    const routes: Record<string, RouteHandler> = {
      [FEED_URL]: () => new Response(JSON.stringify(feed)),
      [feed.assets[0].url]: () => new Response(soundsPayload),
      [feed.assets[1].url]: () => new Response(new Uint8Array(zipPayload)),
    };

    const sync = service(userData, routes, calls);
    const outcome = await sync.sync(root);
    expect(outcome).toEqual({ status: "updated", packVersion: "1.0.0" });
    expect(await readFile(join(root, "data", "sounds.pack"), "utf8")).toBe("custom sounds");
    expect(await readFile(join(root, "Resources", "texture.dat"), "utf8")).toBe("custom texture");
    expect(await readFile(join(userData, "asset-backups", "data", "sounds.pack"), "utf8")).toBe("vanilla sounds");

    const state = await sync.readState();
    expect(state?.packVersion).toBe("1.0.0");
    expect(state?.assets.map((asset) => asset.name)).toEqual(["rotk-sounds", "rotk-ui"]);
    expect(state?.assets[1].installedFiles).toEqual([
      { path: "Resources/texture.dat", sha256: sha256("custom texture"), size: 14 },
    ]);

    // Unchanged feed: nothing is downloaded again.
    calls.length = 0;
    expect(await sync.sync(root)).toEqual({ status: "up-to-date", packVersion: "1.0.0" });
    expect(calls).toEqual([FEED_URL]);
  });

  it("repairs a missing installed file from the local cache without re-downloading", async () => {
    const { userData, root } = await setup();
    const payload = Buffer.from("repairable");
    const feed = manifest([assetEntry("repair.dat", payload)]);
    const calls: string[] = [];
    const sync = service(userData, {
      [FEED_URL]: () => new Response(JSON.stringify(feed)),
      [feed.assets[0].url]: () => new Response(payload),
    }, calls);

    await sync.sync(root);
    await rm(join(root, "repair.dat"));
    calls.length = 0;

    expect(await sync.sync(root)).toEqual({ status: "updated", packVersion: "1.0.0" });
    expect(await readFile(join(root, "repair.dat"), "utf8")).toBe("repairable");
    expect(calls).toEqual([FEED_URL]);
  });

  it("verify() detects silent corruption and reinstalls the asset", async () => {
    const { userData, root } = await setup();
    const payload = Buffer.from("pristine-content");
    const feed = manifest([assetEntry("check.dat", payload)]);
    const sync = service(userData, {
      [FEED_URL]: () => new Response(JSON.stringify(feed)),
      [feed.assets[0].url]: () => new Response(payload),
    });

    await sync.sync(root);
    // Same size, different bytes: only a thorough re-hash can catch it.
    await writeFile(join(root, "check.dat"), "tampered-content");
    expect(await sync.sync(root)).toEqual({ status: "up-to-date", packVersion: "1.0.0" });
    expect(await sync.verify(root)).toEqual({ status: "updated", packVersion: "1.0.0" });
    expect(await readFile(join(root, "check.dat"), "utf8")).toBe("pristine-content");
  });

  it("never installs a download whose SHA-256 does not match the manifest", async () => {
    const { userData, root } = await setup();
    const announced = Buffer.from("announced-bytes");
    const feed = manifest([assetEntry("evil.dat", announced)]);
    const sync = service(userData, {
      [FEED_URL]: () => new Response(JSON.stringify(feed)),
      [feed.assets[0].url]: () => new Response(Buffer.from("swapped-bytes!!")),
    });

    await expect(sync.sync(root)).rejects.toThrow("est corrompu");
    await expect(stat(join(root, "evil.dat"))).rejects.toThrow();
    expect(await sync.readState()).toBeNull();
    const cacheEntries = await readdir(join(userData, "asset-cache"));
    expect(cacheEntries).toEqual([]);
  });

  it("blocks only a first sync when the feed is unreachable", async () => {
    const { userData, root } = await setup();
    const failing = service(userData, {});
    await expect(failing.sync(root)).rejects.toThrow("indisponible");

    const payload = Buffer.from("online-once");
    const feed = manifest([assetEntry("pack.dat", payload)]);
    const online = service(userData, {
      [FEED_URL]: () => new Response(JSON.stringify(feed)),
      [feed.assets[0].url]: () => new Response(payload),
    });
    await online.sync(root);

    const offlineAgain = service(userData, {});
    expect(await offlineAgain.sync(root)).toEqual({
      status: "offline-warning",
      packVersion: "1.0.0",
    });
    expect(await readFile(join(root, "pack.dat"), "utf8")).toBe("online-once");
  });

  it("follows GitHub release redirects but refuses foreign hosts", async () => {
    const { userData, root } = await setup();
    const payload = Buffer.from("released");
    const feed = manifest([assetEntry("release.dat", payload)]);
    const mirror = "https://objects.githubusercontent.com/signed/release.dat";
    const good = service(userData, {
      [FEED_URL]: () => new Response(JSON.stringify(feed)),
      [feed.assets[0].url]: () => Response.redirect(mirror, 302),
      [mirror]: () => new Response(payload),
    });
    await good.sync(root);
    expect(await readFile(join(root, "release.dat"), "utf8")).toBe("released");

    const { userData: userData2, root: root2 } = await setup();
    const evil = service(userData2, {
      [FEED_URL]: () => new Response(JSON.stringify(feed)),
      [feed.assets[0].url]: () => Response.redirect("https://evil.example/release.dat", 302),
    });
    await expect(evil.sync(root2)).rejects.toThrow("Hôte de téléchargement d’assets non autorisé");
    await expect(stat(join(root2, "release.dat"))).rejects.toThrow();
  });

  it("rejects a zip pack containing traversal entries or executable files", async () => {
    const { userData, root } = await setup();
    const slipZip = buildZip([{ name: "../escape.txt", data: "boom" }]);
    const slipFeed = manifest([assetEntry("slip", slipZip, { type: "zip", installPath: "." })]);
    const slip = service(userData, {
      [FEED_URL]: () => new Response(JSON.stringify(slipFeed)),
      [slipFeed.assets[0].url]: () => new Response(new Uint8Array(slipZip)),
    });
    await expect(slip.sync(root)).rejects.toThrow("Archive d’assets invalide");
    await expect(stat(join(dirname(root), "escape.txt"))).rejects.toThrow();

    const { userData: userData2, root: root2 } = await setup();
    const dllZip = buildZip([{ name: "innocent.dat", data: "ok" }, { name: "mod.dll", data: "MZ" }]);
    const dllFeed = manifest([assetEntry("dll-pack", dllZip, { type: "zip", installPath: "." })]);
    const dll = service(userData2, {
      [FEED_URL]: () => new Response(JSON.stringify(dllFeed)),
      [dllFeed.assets[0].url]: () => new Response(new Uint8Array(dllZip)),
    });
    await expect(dll.sync(root2)).rejects.toThrow("extension interdite");
    // The offending pack is rejected as a whole, before any file lands.
    await expect(stat(join(root2, "innocent.dat"))).rejects.toThrow();
  });

  it("removes assets dropped from the feed and restores backed-up originals", async () => {
    const { userData, root } = await setup();
    await writeFile(join(root, "overlay.pack"), "vanilla overlay");
    const payload = Buffer.from("custom overlay");
    const feedV1 = manifest([assetEntry("overlay", payload, { installPath: "overlay.pack" })]);
    const first = service(userData, {
      [FEED_URL]: () => new Response(JSON.stringify(feedV1)),
      [feedV1.assets[0].url]: () => new Response(payload),
    });
    await first.sync(root);
    expect(await readFile(join(root, "overlay.pack"), "utf8")).toBe("custom overlay");

    const second = service(userData, {
      [FEED_URL]: () => new Response(JSON.stringify(manifest([], "2.0.0"))),
    });
    expect(await second.sync(root)).toEqual({ status: "updated", packVersion: "2.0.0" });
    expect(await readFile(join(root, "overlay.pack"), "utf8")).toBe("vanilla overlay");
  });

  it("restore() returns the client to vanilla and forgets the sync state", async () => {
    const { userData, root } = await setup();
    await writeFile(join(root, "replaced.pack"), "vanilla bytes");
    const replaced = Buffer.from("custom bytes!");
    const added = Buffer.from("brand new");
    const feed = manifest([
      assetEntry("replaced", replaced, { installPath: "replaced.pack" }),
      assetEntry("added", added, { installPath: "added.pack" }),
    ]);
    const sync = service(userData, {
      [FEED_URL]: () => new Response(JSON.stringify(feed)),
      [feed.assets[0].url]: () => new Response(replaced),
      [feed.assets[1].url]: () => new Response(added),
    });
    await sync.sync(root);

    await sync.restore(root);
    expect(await readFile(join(root, "replaced.pack"), "utf8")).toBe("vanilla bytes");
    await expect(stat(join(root, "added.pack"))).rejects.toThrow();
    expect(await sync.readState()).toBeNull();
    await expect(stat(join(userData, "asset-backups"))).rejects.toThrow();
  });
});
