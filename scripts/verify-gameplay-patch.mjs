import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const expectedHash =
  "307603aaebdebf52fa55ad0a7337abd785e5190d1bf71e07520240fed51fbd7a";
const expectedBytes = 24_064;
const builtPath = resolve(
  process.argv[2] ?? "native/gameplaypatch/dist/dinput8.dll",
);
const bundledPath = resolve(
  process.argv[3] ?? "resources/patches/dinput8.dll",
);

const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const built = await readFile(builtPath);
const bundled = await readFile(bundledPath);
const sidecar = await readFile(`${bundledPath}.sha256`, "ascii");
const sidecarMatch = sidecar.match(
  /^([0-9a-f]{64})\s+\*?dinput8\.dll\s*$/u,
);

if (built.byteLength !== expectedBytes || bundled.byteLength !== expectedBytes) {
  throw new Error(
    `Unexpected gameplay patch size: built=${built.byteLength}, bundled=${bundled.byteLength}`,
  );
}
const builtHash = sha256(built);
const bundledHash = sha256(bundled);
if (
  builtHash !== expectedHash ||
  bundledHash !== expectedHash ||
  sidecarMatch?.[1] !== expectedHash
) {
  throw new Error(
    `Gameplay patch digest mismatch: expected=${expectedHash}, built=${builtHash}, bundled=${bundledHash}`,
  );
}
if ((await stat(builtPath)).size !== (await stat(bundledPath)).size) {
  throw new Error("Built and bundled gameplay patches differ in size.");
}

const requiredBinarySequences = [
  Buffer.from([
    0x44, 0x8B, 0x87, 0x64, 0x3B, 0x00, 0x00, 0x45,
    0x85, 0xC0, 0x0F, 0x8F, 0x9E, 0x00, 0x00, 0x00,
    0x83, 0xBF, 0xA0, 0x09, 0x00, 0x00, 0x02,
  ]),
  Buffer.from([
    0x0F, 0xB6, 0x9E, 0x41, 0x03, 0x00, 0x00,
    0xF6, 0xC3, 0x40, 0x74, 0x09, 0xC0, 0xEB, 0x07,
    0xEB, 0x09, 0x32, 0xDB, 0xEB, 0x05,
    0x0F, 0xB6, 0x5C, 0x24, 0x34,
  ]),
  Buffer.from("DirectInput8Create\0", "ascii"),
  Buffer.from("\\dinput8.dll\0", "utf16le"),
];
for (const sequence of requiredBinarySequences) {
  if (built.indexOf(sequence) < 0) {
    throw new Error(
      `Gameplay patch binary is missing contract sequence ${sequence.toString("hex")}.`,
    );
  }
}

console.log(
  `Verified gameplay patch: ${expectedHash} (${expectedBytes} bytes, source rebuild matches bundle)`,
);
