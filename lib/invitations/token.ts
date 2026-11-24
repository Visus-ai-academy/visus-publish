import { createHash, randomBytes } from "node:crypto";

/** Token do link de convite. O banco guarda só o sha256 (hex). */
export function newInviteToken() {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
