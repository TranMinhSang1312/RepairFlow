import { describe, expect, it } from "vitest";

import { stripImageMetadata } from "./image-metadata.js";

describe("stripImageMetadata", () => {
  it("removes JPEG APP/EXIF and comment segments before the scan data", () => {
    const bytes = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x06, 0x45, 0x58, 0x49, 0x46, 0xff, 0xfe, 0x00, 0x05, 0x47,
      0x50, 0x53, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9,
    ]);
    const cleaned = stripImageMetadata(bytes, "image/jpeg");
    expect(Buffer.from(cleaned).toString("latin1")).not.toContain("EXIF");
    expect(Buffer.from(cleaned).toString("latin1")).not.toContain("GPS");
    expect(cleaned.slice(0, 2)).toEqual(Uint8Array.of(0xff, 0xd8));
    expect(cleaned).toContain(0xda);
  });

  it("keeps critical PNG chunks and removes all ancillary metadata chunks", () => {
    const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const chunk = (type: string, data: number[]) => {
      const output = new Uint8Array(12 + data.length);
      output[3] = data.length;
      output.set(new TextEncoder().encode(type), 4);
      output.set(data, 8);
      return output;
    };
    const bytes = concat([
      signature,
      chunk("IHDR", [1]),
      chunk("tEXt", [...new TextEncoder().encode("GPS=secret")]),
      chunk("IDAT", [2]),
      chunk("IEND", []),
    ]);
    const cleaned = stripImageMetadata(bytes, "image/png");
    const text = Buffer.from(cleaned).toString("latin1");
    expect(text).toContain("IHDR");
    expect(text).toContain("IDAT");
    expect(text).not.toContain("tEXt");
    expect(text).not.toContain("GPS=secret");
  });
});

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
