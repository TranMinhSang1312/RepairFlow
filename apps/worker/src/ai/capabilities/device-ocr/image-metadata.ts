const JPEG_START = Uint8Array.of(0xff, 0xd8);
const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

/** Removes metadata containers before an image crosses the provider boundary. */
export function stripImageMetadata(bytes: Uint8Array, mediaType: string): Uint8Array {
  switch (mediaType) {
    case "image/jpeg":
      return stripJpegMetadata(bytes);
    case "image/png":
      return stripPngMetadata(bytes);
    case "image/webp":
      return stripWebpMetadata(bytes);
    default:
      throw new Error("AI_MEDIA_TYPE_INVALID");
  }
}

function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (!startsWith(bytes, JPEG_START)) throw new Error("AI_MEDIA_CONTENT_INVALID");
  const parts: Uint8Array[] = [bytes.slice(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff || offset + 1 >= bytes.length) {
      throw new Error("AI_MEDIA_CONTENT_INVALID");
    }
    let markerOffset = offset;
    while (bytes[markerOffset] === 0xff) markerOffset += 1;
    const marker = bytes[markerOffset];
    if (marker === undefined) throw new Error("AI_MEDIA_CONTENT_INVALID");
    if (marker === 0xda) {
      parts.push(bytes.slice(offset));
      return concat(parts);
    }
    if (marker === 0xd9) {
      parts.push(bytes.slice(offset, markerOffset + 1));
      return concat(parts);
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(bytes.slice(offset, markerOffset + 1));
      offset = markerOffset + 1;
      continue;
    }
    if (markerOffset + 2 >= bytes.length) throw new Error("AI_MEDIA_CONTENT_INVALID");
    const length = (bytes[markerOffset + 1]! << 8) | bytes[markerOffset + 2]!;
    const end = markerOffset + 1 + length;
    if (length < 2 || end > bytes.length) throw new Error("AI_MEDIA_CONTENT_INVALID");
    const metadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) parts.push(bytes.slice(offset, end));
    offset = end;
  }
  throw new Error("AI_MEDIA_CONTENT_INVALID");
}

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  if (!startsWith(bytes, PNG_SIGNATURE)) throw new Error("AI_MEDIA_CONTENT_INVALID");
  const parts: Uint8Array[] = [bytes.slice(0, PNG_SIGNATURE.length)];
  let offset = PNG_SIGNATURE.length;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = readUint32Be(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("AI_MEDIA_CONTENT_INVALID");
    const type = ascii(bytes.slice(offset + 4, offset + 8));
    // PNG critical chunks begin with an uppercase byte. Keep only those and discard every
    // ancillary metadata chunk, including eXIf, text, time and location-bearing extensions.
    if (/^[A-Z]/u.test(type)) parts.push(bytes.slice(offset, end));
    offset = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new Error("AI_MEDIA_CONTENT_INVALID");
  return concat(parts);
}

function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  if (
    bytes.length < 12 ||
    ascii(bytes.slice(0, 4)) !== "RIFF" ||
    ascii(bytes.slice(8, 12)) !== "WEBP"
  ) {
    throw new Error("AI_MEDIA_CONTENT_INVALID");
  }
  const chunks: Uint8Array[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes.slice(offset, offset + 4));
    const length = readUint32Le(bytes, offset + 4);
    const end = offset + 8 + length + (length % 2);
    if (end > bytes.length) throw new Error("AI_MEDIA_CONTENT_INVALID");
    if (!new Set(["EXIF", "XMP ", "ICCP"]).has(type)) {
      const chunk = bytes.slice(offset, end);
      if (type === "VP8X" && length >= 1) {
        const cleaned = chunk.slice();
        cleaned[8] = cleaned[8]! & ~0x2c;
        chunks.push(cleaned);
      } else {
        chunks.push(chunk);
      }
    }
    offset = end;
  }
  if (offset !== bytes.length || chunks.length === 0) throw new Error("AI_MEDIA_CONTENT_INVALID");
  const bodyLength = 4 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode("RIFF"), 0);
  writeUint32Le(header, 4, bodyLength);
  header.set(new TextEncoder().encode("WEBP"), 8);
  return concat([header, ...chunks]);
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => value[index] === byte);
}

function readUint32Be(value: Uint8Array, offset: number): number {
  return (
    value[offset]! * 0x1000000 +
    value[offset + 1]! * 0x10000 +
    value[offset + 2]! * 0x100 +
    value[offset + 3]!
  );
}

function readUint32Le(value: Uint8Array, offset: number): number {
  return (
    value[offset]! +
    value[offset + 1]! * 0x100 +
    value[offset + 2]! * 0x10000 +
    value[offset + 3]! * 0x1000000
  );
}

function writeUint32Le(value: Uint8Array, offset: number, number: number): void {
  value[offset] = number & 0xff;
  value[offset + 1] = (number >>> 8) & 0xff;
  value[offset + 2] = (number >>> 16) & 0xff;
  value[offset + 3] = (number >>> 24) & 0xff;
}

function ascii(value: Uint8Array): string {
  return new TextDecoder("ascii", { fatal: true }).decode(value);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
