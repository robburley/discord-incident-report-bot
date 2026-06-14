import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getStewardUserGuideMessages,
  splitStewardGuideMessages
} from "../../src/core/help";
import { STEWARD_USER_GUIDE } from "../../src/core/help-content";
import { DISCORD_MESSAGE_LIMIT } from "../../src/core/summary";

describe("steward user guide", () => {
  it("keeps the bundled guide aligned with the docs source", () => {
    const source = readFileSync(
      join(process.cwd(), "docs", "steward-user-guide.md"),
      "utf8"
    ).trim();

    expect(STEWARD_USER_GUIDE).toBe(source);
  });

  it("returns stable Discord-safe guide messages", () => {
    const messages = getStewardUserGuideMessages();

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((message) => message.length > 0)).toBe(true);
    expect(messages.every((message) => message.length <= DISCORD_MESSAGE_LIMIT)).toBe(
      true
    );
    expect(messages.join("\n\n")).toBe(STEWARD_USER_GUIDE);
  });

  it("prefers paragraph and heading boundaries when chunking", () => {
    const messages = splitStewardGuideMessages(
      "# First\n\nShort paragraph.\n\n## Second\n\nAnother paragraph.",
      30
    );

    expect(messages).toEqual([
      "# First\n\nShort paragraph.",
      "## Second\n\nAnother paragraph."
    ]);
  });

  it("splits a single oversized paragraph safely", () => {
    const messages = splitStewardGuideMessages("abcdef", 2);

    expect(messages).toEqual(["ab", "cd", "ef"]);
  });

  it("rejects empty guide content", () => {
    expect(() => splitStewardGuideMessages("  \n  ")).toThrow(
      "Steward user guide content must not be empty."
    );
  });
});
