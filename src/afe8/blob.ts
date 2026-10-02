import { unzlibSync } from 'fflate';

/**
 * ASTRA stores every array-valued column as a BLOB with a 16-byte header:
 *
 *   u32 totalSize      size of the whole blob in bytes (header included)
 *   u32 checksum       (only set for compressed payloads)
 *   u32 rawSize        size of the uncompressed payload
 *   u32 rawSize        repeated
 *
 * followed by the payload, which is zlib-compressed (starts with 0x78) when
 * it is large and stored verbatim otherwise.
 */
export function blobPayload(blob: Uint8Array | null | undefined): Uint8Array {
  if (!blob || blob.length < 16) return new Uint8Array(0);
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const rawSize = dv.getUint32(8, true);
  const body = blob.subarray(16);
  if (rawSize === 0) return new Uint8Array(0);
  if (body.length !== rawSize && body.length >= 2 && body[0] === 0x78) {
    try {
      return unzlibSync(body);
    } catch {
      /* fall through: treat as raw */
    }
  }
  return body;
}

function aligned(bytes: Uint8Array): ArrayBuffer {
  // Copy into a fresh buffer so typed-array views are always aligned.
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

export function decodeFloat64(blob: Uint8Array | null | undefined): Float64Array {
  const p = blobPayload(blob);
  return new Float64Array(aligned(p.subarray(0, p.length - (p.length % 8))));
}

export function decodeFloat32(blob: Uint8Array | null | undefined): Float32Array {
  const p = blobPayload(blob);
  return new Float32Array(aligned(p.subarray(0, p.length - (p.length % 4))));
}

export function decodeInt32(blob: Uint8Array | null | undefined): Int32Array {
  const p = blobPayload(blob);
  return new Int32Array(aligned(p.subarray(0, p.length - (p.length % 4))));
}

export function decodeBool(blob: Uint8Array | null | undefined): boolean[] {
  return Array.from(blobPayload(blob), (b) => b !== 0);
}

/**
 * Decode a numeric array whose element size is not known up front: ASTRA
 * stores most signals as float64 but some (e.g. UV matrices) as float32.
 * `count` is the expected number of elements.
 */
export function decodeNumeric(blob: Uint8Array | null | undefined, count: number): Float64Array {
  const p = blobPayload(blob);
  if (count <= 0) return new Float64Array(0);
  const elem = p.length / count;
  if (elem === 4) return Float64Array.from(new Float32Array(aligned(p)));
  if (elem === 8) return new Float64Array(aligned(p));
  // Unexpected size: best effort as float64.
  return new Float64Array(aligned(p.subarray(0, p.length - (p.length % 8))));
}

/** GUID lists are stored as 16-byte little-endian GUID structs. */
export function decodeGuids(blob: Uint8Array | null | undefined): string[] {
  const p = blobPayload(blob);
  const out: string[] = [];
  const hex = (b: number) => b.toString(16).padStart(2, '0');
  for (let o = 0; o + 16 <= p.length; o += 16) {
    const d1 = [3, 2, 1, 0].map((i) => hex(p[o + i])).join('');
    const d2 = [5, 4].map((i) => hex(p[o + i])).join('');
    const d3 = [7, 6].map((i) => hex(p[o + i])).join('');
    const d4 = [8, 9].map((i) => hex(p[o + i])).join('');
    const d5 = [10, 11, 12, 13, 14, 15].map((i) => hex(p[o + i])).join('');
    out.push(`{${d1}-${d2}-${d3}-${d4}-${d5}}`.toUpperCase());
  }
  return out;
}

/** String lists use U+8779 as separator (an artefact of ASTRA's serialiser). */
export function splitStringList(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split('蝹').map((x) => x.trim()).filter((x) => x.length > 0);
}
