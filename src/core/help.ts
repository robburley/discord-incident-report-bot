import { DISCORD_MESSAGE_LIMIT } from "./summary";
import { STEWARD_USER_GUIDE } from "./help-content";

export function getStewardUserGuideMessages(
  limit = DISCORD_MESSAGE_LIMIT
): string[] {
  return splitStewardGuideMessages(STEWARD_USER_GUIDE, limit);
}

export function splitStewardGuideMessages(
  content: string,
  limit = DISCORD_MESSAGE_LIMIT
): string[] {
  if (limit < 1) {
    throw new Error("Discord message limit must be positive.");
  }

  const normalized = content.trim();

  if (normalized.length === 0) {
    throw new Error("Steward user guide content must not be empty.");
  }

  const chunks: string[] = [];
  let current = "";

  for (const block of normalized.split(/\n{2,}/u)) {
    const pending = current.length === 0 ? block : `${current}\n\n${block}`;

    if (pending.length <= limit) {
      current = pending;
      continue;
    }

    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }

    if (block.length <= limit) {
      current = block;
      continue;
    }

    const blockChunks = splitLongBlock(block, limit);
    chunks.push(...blockChunks.slice(0, -1));
    current = blockChunks.at(-1) ?? "";
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function splitLongBlock(block: string, limit: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of block.split("\n")) {
    const pending = current.length === 0 ? line : `${current}\n${line}`;

    if (pending.length <= limit) {
      current = pending;
      continue;
    }

    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }

    if (line.length <= limit) {
      current = line;
      continue;
    }

    for (let index = 0; index < line.length; index += limit) {
      chunks.push(line.slice(index, index + limit));
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}
