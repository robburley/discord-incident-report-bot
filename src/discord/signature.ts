import { verifyKey } from "discord-interactions";

export const DISCORD_SIGNATURE_HEADER = "X-Signature-Ed25519";
export const DISCORD_TIMESTAMP_HEADER = "X-Signature-Timestamp";

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

  return verifyKey(
    input.rawBody,
    input.signature,
    input.timestamp,
    input.publicKey
  );
}
