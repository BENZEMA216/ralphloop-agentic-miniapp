import { createHash, randomUUID } from "node:crypto";

export function generateShareToken(): string {
  return randomUUID();
}

export function hashShareToken(token: string): string {
  return sha256(token);
}

export function generateDeviceKey(): string {
  return randomUUID();
}

export function hashDeviceKey(deviceKey: string): string {
  return sha256(deviceKey);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
