import { deflateRawSync } from "node:zlib";

/**
 * Minimal ZIP writer used to craft both valid and deliberately malicious
 * archives for the asset-pack extractor tests.
 */

export interface ZipSpecEntry {
  name: string;
  data?: Buffer | string;
  directory?: boolean;
  method?: 0 | 8;
  flags?: number;
  /** Overrides to forge inconsistent size fields. */
  declaredUncompressedSize?: number;
  declaredCompressedSize?: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZip(entries: ZipSpecEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const spec of entries) {
    const nameBuffer = Buffer.from(spec.name, "utf8");
    const data = spec.directory
      ? Buffer.alloc(0)
      : Buffer.isBuffer(spec.data) ? spec.data : Buffer.from(spec.data ?? "");
    const method = spec.method ?? 0;
    const payload = method === 8 ? deflateRawSync(data) : data;
    const crc = crc32(data);
    const uncompressedSize = spec.declaredUncompressedSize ?? data.length;
    const compressedSize = spec.declaredCompressedSize ?? payload.length;
    const flags = spec.flags ?? 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localChunks.push(localHeader, nameBuffer, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralChunks.push(centralHeader, nameBuffer);

    offset += 30 + nameBuffer.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  return Buffer.concat([...localChunks, centralDirectory, endRecord]);
}
