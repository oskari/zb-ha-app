/**
 * imageFrame.test.ts — Pure unit tests for the ESP32 framed-reply builder
 *
 * Covers Self-host-mode.md §5.1 (header), §5.3 (bit polarity), §5.4
 * (localTime packing) — including the exact worked example from §5.6, used
 * here as a golden test vector.
 */

import { describe, it, expect } from "vitest";
import {
  buildFramedHeader,
  buildFramedReply,
  invertBitPolarity,
  packLocalTime,
} from "../src/ha/imageFrame";

describe("invertBitPolarity", () => {
  it("flips every bit (Canvas 1=black -> wire 1=white)", () => {
    const out = invertBitPolarity(Buffer.from([0x00, 0xff, 0xaa, 0x55]));
    expect([...out]).toEqual([0xff, 0x00, 0x55, 0xaa]);
  });

  it("preserves buffer length", () => {
    const bin = Buffer.alloc(100, 0x00);
    expect(invertBitPolarity(bin).length).toBe(100);
  });

  it("handles an empty buffer", () => {
    expect(invertBitPolarity(Buffer.alloc(0)).length).toBe(0);
  });

  it("is its own inverse (double inversion is a no-op)", () => {
    const original = Buffer.from([0x12, 0x34, 0xab, 0xcd, 0x00, 0xff]);
    const roundTripped = invertBitPolarity(invertBitPolarity(original));
    expect(roundTripped.equals(original)).toBe(true);
  });
});

describe("packLocalTime", () => {
  it("matches the exact worked example from Self-host-mode.md §5.6 (2026-07-06 14:30:00, 24h)", () => {
    const date = new Date(2026, 6, 6, 14, 30, 0); // JS months are 0-indexed: 6 = July
    const packed = packLocalTime(date);
    expect([...packed]).toEqual([0x1c, 0xf0, 0x0f, 0xd4, 0xe6]);
  });

  it("is exactly 5 bytes", () => {
    expect(packLocalTime(new Date()).length).toBe(5);
  });

  it("always encodes mode=0 (24-hour) — top 2 bits of byte0 are 00", () => {
    const packed = packLocalTime(new Date(2026, 0, 1, 0, 0, 0));
    expect(packed[0] >> 6).toBe(0);
  });

  it("falls back to NO_CLOCK (C0 00 00 00 00) for an invalid Date", () => {
    const packed = packLocalTime(new Date(NaN));
    expect([...packed]).toEqual([0xc0, 0x00, 0x00, 0x00, 0x00]);
  });

  it("round-trips hour/minute/second/year/month/day through the documented bit layout", () => {
    const date = new Date(2030, 11, 31, 23, 59, 58); // 2030-12-31 23:59:58
    const packed = packLocalTime(date);
    let value = 0n;
    for (const byte of packed) value = (value << 8n) | BigInt(byte);

    const mode = Number((value >> 38n) & 0x3n);
    const hour = Number((value >> 33n) & 0x1fn);
    const minute = Number((value >> 27n) & 0x3fn);
    const second = Number((value >> 21n) & 0x3fn);
    const year = Number((value >> 9n) & 0xfffn);
    const month = Number((value >> 5n) & 0xfn);
    const day = Number(value & 0x1fn);

    expect({ mode, hour, minute, second, year, month, day }).toEqual({
      mode: 0,
      hour: 23,
      minute: 59,
      second: 58,
      year: 2030,
      month: 12,
      day: 31,
    });
  });
});

describe("buildFramedHeader", () => {
  const localTime = Buffer.from([0xc0, 0x00, 0x00, 0x00, 0x00]);

  it("is exactly 25 bytes", () => {
    const header = buildFramedHeader({ width: 800, height: 480, payloadLen: 48000, localTime });
    expect(header.length).toBe(25);
  });

  it("writes magic 0x5A46 as bytes 46 5A (little-endian) at offset 0", () => {
    const header = buildFramedHeader({ width: 800, height: 480, payloadLen: 48000, localTime });
    expect(header[0]).toBe(0x46);
    expect(header[1]).toBe(0x5a);
    expect(header.readUInt16LE(0)).toBe(0x5a46);
  });

  it("writes width and height little-endian at offsets 2 and 4", () => {
    const header = buildFramedHeader({ width: 720, height: 480, payloadLen: 43200, localTime });
    expect(header.readUInt16LE(2)).toBe(720);
    expect(header.readUInt16LE(4)).toBe(480);
  });

  it("always writes x=0, y=0 (offsets 6, 8)", () => {
    const header = buildFramedHeader({ width: 800, height: 480, payloadLen: 48000, localTime });
    expect(header.readUInt16LE(6)).toBe(0);
    expect(header.readUInt16LE(8)).toBe(0);
  });

  it("always writes flags=0x0000 — partial refresh (offset 10)", () => {
    const header = buildFramedHeader({ width: 800, height: 480, payloadLen: 48000, localTime });
    expect(header.readUInt16LE(10)).toBe(0x0000);
  });

  it("always writes nextWake=0 — device uses its own configured sleepSec (offset 12)", () => {
    const header = buildFramedHeader({ width: 800, height: 480, payloadLen: 48000, localTime });
    expect(header.readUInt32LE(12)).toBe(0);
  });

  it("writes payloadLen little-endian at offset 16, matching ceil(width/8)*height", () => {
    const width = 800;
    const height = 480;
    const payloadLen = Math.ceil(width / 8) * height;
    const header = buildFramedHeader({ width, height, payloadLen, localTime });
    expect(header.readUInt32LE(16)).toBe(48000);
  });

  it("copies localTime verbatim (already big-endian) into offset 20..25", () => {
    const clock = Buffer.from([0x1c, 0xf0, 0x0f, 0xd4, 0xe6]);
    const header = buildFramedHeader({ width: 800, height: 480, payloadLen: 48000, localTime: clock });
    expect(header.subarray(20, 25).equals(clock)).toBe(true);
  });
});

describe("buildFramedReply", () => {
  it("concatenates a 25-byte header with the polarity-inverted image bytes", () => {
    const binBuffer = Buffer.from([0x00, 0xff, 0x0f]); // Canvas convention (1=black)
    const reply = buildFramedReply({ width: 8, height: 3, binBuffer, now: new Date(2026, 6, 6, 14, 30, 0) });

    expect(reply.length).toBe(25 + binBuffer.length);
    expect(reply.readUInt16LE(0)).toBe(0x5a46);
    expect(reply.readUInt16LE(2)).toBe(8);
    expect(reply.readUInt16LE(4)).toBe(3);
    expect(reply.readUInt32LE(16)).toBe(binBuffer.length);
    expect([...reply.subarray(20, 25)]).toEqual([0x1c, 0xf0, 0x0f, 0xd4, 0xe6]);
    // Image bytes are the wire (1=white) convention, i.e. inverted from Canvas's 1=black.
    expect([...reply.subarray(25)]).toEqual([0xff, 0x00, 0xf0]);
  });

  it("payloadLen always equals the image byte length actually appended", () => {
    const binBuffer = Buffer.alloc(90 * 480, 0x00); // 720-wide (sidebar-on) full screen
    const reply = buildFramedReply({ width: 720, height: 480, binBuffer, now: new Date() });
    const payloadLen = reply.readUInt32LE(16);
    expect(payloadLen).toBe(binBuffer.length);
    expect(reply.length).toBe(25 + payloadLen);
  });

  it("defaults `now` to the live clock when omitted", () => {
    const before = new Date();
    const reply = buildFramedReply({ width: 1, height: 1, binBuffer: Buffer.from([0x00]) });
    const after = new Date();

    let value = 0n;
    for (const byte of reply.subarray(20, 25)) value = (value << 8n) | BigInt(byte);
    const year = Number((value >> 9n) & 0xfffn);
    // Loose sanity check only (exact-second flakiness) — proves it used a
    // real live clock, not NO_CLOCK / a fixed sentinel.
    expect(year).toBe(before.getFullYear());
    expect(year).toBe(after.getFullYear());
  });
});
