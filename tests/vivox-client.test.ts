import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { vivoxClientInternals } from "../electron/services/vivox-client.js";

const temporaryDirectories: string[] = [];

function hash(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

const contents = {
  v4: "stock-vivox-v4",
  v5: "official-vivox-v5",
  proxy: "rotk-vivox-proxy",
  stale: "stale-or-corrupt",
};

const policy = {
  stockV4Sha256: hash(contents.v4),
  stockV5Sha256: hash(contents.v5),
  proxySha256: hash(contents.proxy),
  proxyMinBytes: 1,
  proxyMaxBytes: 1_024,
};

async function createFixture(): Promise<{
  root: string;
  proxy: string;
  runtime: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "rotk-vivox-test-"));
  temporaryDirectories.push(directory);

  const root = join(directory, "game");
  const proxy = join(directory, "bundled-proxy.dll");
  const runtime = join(directory, "bundled-v5.dll");
  await mkdir(root);
  await writeFile(proxy, contents.proxy);
  await writeFile(runtime, contents.v5);
  return { root, proxy, runtime };
}

async function deploy(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): Promise<void> {
  await vivoxClientInternals.deployVivoxCompatibilityWithPolicy(
    fixture.root,
    fixture.proxy,
    fixture.runtime,
    policy,
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("Vivox client deployment", () => {
  it("installs and verifies both DLLs while preserving the stock runtime", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.root, "vivoxsdk_x64.dll"), contents.v4);

    await deploy(fixture);
    await deploy(fixture);

    await expect(readFile(join(fixture.root, "vivoxsdk_x64.dll"), "utf8"))
      .resolves.toBe(contents.proxy);
    await expect(readFile(join(fixture.root, "vivoxsdk_x64_v5.dll"), "utf8"))
      .resolves.toBe(contents.v5);
    await expect(readFile(join(fixture.root, "vivoxsdk_x64.original.dll"), "utf8"))
      .resolves.toBe(contents.v4);
  });

  it("repairs a stale proxy and a corrupt Vivox 5 runtime", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.root, "vivoxsdk_x64.dll"), contents.stale);
    await writeFile(join(fixture.root, "vivoxsdk_x64.original.dll"), contents.v4);
    await writeFile(join(fixture.root, "vivoxsdk_x64_v5.dll"), contents.stale);

    await deploy(fixture);

    await expect(readFile(join(fixture.root, "vivoxsdk_x64.dll"), "utf8"))
      .resolves.toBe(contents.proxy);
    await expect(readFile(join(fixture.root, "vivoxsdk_x64_v5.dll"), "utf8"))
      .resolves.toBe(contents.v5);
  });

  it("migrates a valid legacy backup over a corrupt canonical backup", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.root, "vivoxsdk_x64.dll"), contents.stale);
    await writeFile(join(fixture.root, "vivoxsdk_x64.original.dll"), contents.stale);
    await writeFile(join(fixture.root, "vivoxsdk_x64_original.dll"), contents.v4);

    await deploy(fixture);

    await expect(readFile(join(fixture.root, "vivoxsdk_x64.original.dll"), "utf8"))
      .resolves.toBe(contents.v4);
    // The legacy name does not match the attestation's `.original.dll` backup
    // shape, so keeping it would flag the install as carrying an unexpected DLL.
    await expect(readFile(join(fixture.root, "vivoxsdk_x64_original.dll")))
      .rejects.toThrow();
  });

  it("leaves an unknown file under the legacy backup name untouched", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.root, "vivoxsdk_x64.dll"), contents.v4);
    await writeFile(join(fixture.root, "vivoxsdk_x64_original.dll"), contents.stale);

    await deploy(fixture);

    // Not our backup: it must survive and surface through attestation instead
    // of being silently deleted.
    await expect(readFile(join(fixture.root, "vivoxsdk_x64_original.dll"), "utf8"))
      .resolves.toBe(contents.stale);
  });

  it("repairs a corrupt backup from an untouched stock DLL", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.root, "vivoxsdk_x64.dll"), contents.v4);
    await writeFile(join(fixture.root, "vivoxsdk_x64.original.dll"), contents.stale);

    await deploy(fixture);

    await expect(readFile(join(fixture.root, "vivoxsdk_x64.original.dll"), "utf8"))
      .resolves.toBe(contents.v4);
  });

  it("fails closed before mutation when no valid stock backup exists", async () => {
    const fixture = await createFixture();
    const activePath = join(fixture.root, "vivoxsdk_x64.dll");
    await writeFile(activePath, contents.stale);

    await expect(deploy(fixture)).rejects.toThrow(/sauvegarde.+invalide/i);
    await expect(readFile(activePath, "utf8")).resolves.toBe(contents.stale);
    await expect(readFile(join(fixture.root, "vivoxsdk_x64_v5.dll")))
      .rejects.toThrow();
  });

  it("fails before mutation when either bundled DLL has an unexpected hash", async () => {
    const fixture = await createFixture();
    const activePath = join(fixture.root, "vivoxsdk_x64.dll");
    await writeFile(activePath, contents.v4);
    await writeFile(fixture.runtime, contents.stale);

    await expect(deploy(fixture)).rejects.toThrow(/runtime Vivox 5.+invalide/i);
    await expect(readFile(activePath, "utf8")).resolves.toBe(contents.v4);

    await writeFile(fixture.runtime, contents.v5);
    await writeFile(fixture.proxy, contents.stale);
    await expect(deploy(fixture)).rejects.toThrow(/proxy vocal ROTK.+invalide/i);
    await expect(readFile(activePath, "utf8")).resolves.toBe(contents.v4);
  });
});
