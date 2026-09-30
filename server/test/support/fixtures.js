/**
 * Image fixtures.
 *
 * These are **signature-only**: a real header followed by zero padding, not a
 * decodable image. That is sufficient and deliberate, because the backend never
 * decodes a photo — it reads the first bytes to establish the format and hands
 * the base64 straight to the model. A test that needed a decodable image would be
 * testing something this server does not do.
 */

function pad(bytes, length) {
  return bytes.length >= length ? bytes : Buffer.concat([bytes, Buffer.alloc(length - bytes.length)]);
}

export function pngBytes(extra = 0) {
  return pad(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]), 24 + extra);
}

export function jpegBytes(extra = 0) {
  return pad(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]), 20 + extra);
}

export function webpBytes(extra = 0) {
  return pad(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]), 20 + extra);
}

export function heicBytes() {
  return Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(16)]);
}

/** Bytes that are not an image at all. */
export function notImageBytes() {
  return Buffer.from('this is a text file, not a photograph', 'utf8');
}

/** The `{ mimeType, data }` shape the app sends. */
export function photo(bytes, mimeType = 'image/png') {
  return { mimeType, data: bytes.toString('base64') };
}
