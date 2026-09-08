import { createRequire } from "node:module";
import { parseArgs } from "node:util";
const { createReleaseManifest } = createRequire(import.meta.url)("./fairplay-release-manifest.cjs");
const { values } = parseArgs({ options: {
  package: { type: "string" }, game: { type: "string" }, "game-sha256": { type: "string" },
  "game-hash-source": { type: "string" }, "game-version": { type: "string" }, label: { type: "string" }, output: { type: "string" },
}, strict: true });
if (!values.package) throw new Error("Usage: --package <win-unpacked> --game <H1Z1.exe> --game-version <version> --label <candidate-name> --output <outside-package.json>. Alternatively --game-sha256 <verified-base-hash> --game-hash-source <provenance>.");
const { manifest, output } = await createReleaseManifest({ packageDir: values.package, gamePath: values.game,
  gameSha256: values["game-sha256"], gameHashSource: values["game-hash-source"], gameVersion: values["game-version"], label: values.label, output: values.output });
console.log(`FairPlay release candidate written: ${output}\n${JSON.stringify(manifest.hashes)}\nImport and activate deliberately in Admin Studio. Nothing was published or activated.`);
