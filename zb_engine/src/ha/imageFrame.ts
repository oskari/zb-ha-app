/**
 * imageFrame.ts — ESP32 self-host framed reply (serve-time only)
 *
 * Builds the 25-byte framed header defined by the ESP32 self-host framing spec,
 * and wraps it around a rendered 1-bit image buffer for the device-facing
 * `POST /image.bin` endpoint.
 *
 * This is a serve-time concern only — `src/encoder/binEncoder.ts` is shared
 * with other consumers (builder raw `.bin` export, deploy-time cached
 * `.bin`) and is never touched here. The frame and the bit-polarity fix
 * below are layered on top of its output only for this one endpoint.
 */

const MAGIC = 0x5a46;
const HEADER_BYTES = 25;

/** `mode = 3` — leave the sidebar clock unchanged. */
const NO_CLOCK = Buffer.from([0xc0, 0x00, 0x00, 0x00, 0x00]);

/**
 * This codebase's `Canvas` packs bit `1` = black, `0` = white (see
 * `engine/canvas.ts`). The ESP32 wire format is the opposite — bit `1` =
 * white. A full byte-wise NOT converts one
 * convention to the other; unset (padding) bits default to 0 in `Canvas`
 * (white in its convention), which correctly becomes 1 (white in the wire
 * convention) after inversion, so no special-casing is needed for the
 * unused trailing bits at the end of a row. `binEncoder.ts` itself is left
 * untouched — this inversion is applied only at serve time for the framed
 * device reply.
 */
export function invertBitPolarity(bin: Buffer): Buffer {
  const out = Buffer.allocUnsafe(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin[i] ^ 0xff;
  return out;
}

/**
 * Pack the 5-byte sidebar clock, most-significant
 * byte first. Always emits 24-hour mode (`mode = 0`) — this add-on has no
 * concept of a per-user 12h preference yet.
 *
 * // TODO: make 12h configurable (the wire format supports mode 1/2 = AM/PM).
 *
 * Falls back to `NO_CLOCK` (mode 3 = leave the clock unchanged) rather than
 * ever emit a nonsensical time, if `date` is invalid.
 */
export function packLocalTime(date: Date): Buffer {
  if (Number.isNaN(date.getTime())) return Buffer.from(NO_CLOCK);

  const mode = 0n; // 24-hour
  const hour = BigInt(date.getHours());
  const minute = BigInt(date.getMinutes());
  const second = BigInt(date.getSeconds());
  const year = BigInt(date.getFullYear());
  const month = BigInt(date.getMonth() + 1);
  const day = BigInt(date.getDate());

  // Regular JS bitwise operators truncate to 32 bits, which silently
  // corrupts a 40-bit value — BigInt is required here.
  const value =
    (mode << 38n) |
    (hour << 33n) |
    (minute << 27n) |
    (second << 21n) |
    (year << 9n) |
    (month << 5n) |
    day;

  const out = Buffer.alloc(5);
  for (let i = 0; i < 5; i++) {
    out[i] = Number((value >> BigInt((4 - i) * 8)) & 0xffn);
  }
  return out;
}

/**
 * Build the 25-byte framed header. All fields
 * except `localTime` are little-endian; `localTime` is 5 bytes, already
 * big-endian (see {@link packLocalTime}).
 */
export function buildFramedHeader(opts: {
  width: number;
  height: number;
  payloadLen: number;
  localTime: Buffer;
}): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt16LE(MAGIC, 0);
  header.writeUInt16LE(opts.width, 2);
  header.writeUInt16LE(opts.height, 4);
  header.writeUInt16LE(0, 6); // x — always 0 (full served image, no sub-rect placement)
  header.writeUInt16LE(0, 8); // y — always 0
  header.writeUInt16LE(0, 10); // flags — 0x0000 = partial refresh (device auto-heals ghosting)
  header.writeUInt32LE(0, 12); // nextWake — 0 = device uses its own configured sleepSec
  header.writeUInt32LE(opts.payloadLen, 16);
  opts.localTime.copy(header, 20);
  return header;
}

/**
 * Build the full framed reply body: `[25-byte header][polarity-corrected
 * image bytes]`. `now` is injectable for tests; defaults to the live clock
 * (the add-on container inherits the HA host's local timezone).
 */
export function buildFramedReply(opts: { width: number; height: number; binBuffer: Buffer; now?: Date }): Buffer {
  const inverted = invertBitPolarity(opts.binBuffer);
  const localTime = packLocalTime(opts.now ?? new Date());
  const header = buildFramedHeader({
    width: opts.width,
    height: opts.height,
    payloadLen: inverted.length,
    localTime,
  });
  return Buffer.concat([header, inverted]);
}
