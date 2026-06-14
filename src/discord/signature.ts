import { verifyKey } from "discord-interactions";

export const DISCORD_SIGNATURE_HEADER = "X-Signature-Ed25519";
export const DISCORD_TIMESTAMP_HEADER = "X-Signature-Timestamp";
export const DISCORD_SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

export interface DiscordSignatureInput {
  readonly rawBody: string;
  readonly signature: string | null;
  readonly timestamp: string | null;
  readonly publicKey: string;
}

export async function verifyDiscordRequestSignature(
  input: DiscordSignatureInput
): Promise<boolean> {
  if (!input.signature || !input.timestamp || !input.publicKey) {
    return false;
  }

  if (!isFreshDiscordTimestamp(input.timestamp)) {
    return false;
  }

  return verifyKey(
    input.rawBody,
    input.signature,
    input.timestamp,
    input.publicKey
  );
}

function isFreshDiscordTimestamp(timestamp: string): boolean {
  if (!/^\d+$/.test(timestamp)) {
    return false;
  }

  const timestampSeconds = Number(timestamp);

  if (!Number.isSafeInteger(timestampSeconds)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1_000);
  return Math.abs(nowSeconds - timestampSeconds) <= DISCORD_SIGNATURE_MAX_AGE_SECONDS;
}
