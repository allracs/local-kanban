import { randomBytes } from "node:crypto";

const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

export function nanoid(length = 6): string {
  let result = "";
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += CHARS[bytes[i] % CHARS.length];
  }
  return result;
}
