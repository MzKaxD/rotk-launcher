import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

const EXPECTED_SHA256 =
  "33a7f704eda23dda9ccbd9eba1fda2f0589211e9c61ec9d1f9c797acc624ea44";
const runtimePath = resolve(
  process.argv[2] ?? "resources/patches/vivoxsdk_x64_v5.dll",
);

const runtime = await stat(runtimePath).catch(() => null);
if (!runtime?.isFile()) {
  throw new Error(
    "The official Vivox 5 runtime is missing from the launcher release inputs.",
  );
}

const hash = createHash("sha256");
for await (const chunk of createReadStream(runtimePath)) {
  hash.update(chunk);
}
const actualSha256 = hash.digest("hex");
if (actualSha256 !== EXPECTED_SHA256) {
  throw new Error(
    `Unexpected Vivox 5 runtime SHA-256: ${actualSha256}`,
  );
}

console.log(
  `Verified official Vivox 5 runtime: ${runtimePath} (${actualSha256})`,
);
