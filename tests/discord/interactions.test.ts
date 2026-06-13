import { describe, expect, it } from "vitest";

import { handleDiscordInteraction } from "../../src/discord/interactions";
import { DISCORD_EPHEMERAL_MESSAGE_FLAG } from "../../src/discord/responses";

describe("handleDiscordInteraction", () => {
  it("responds to Discord ping interactions with pong", async () => {
    const result = await handleDiscordInteraction({ type: 1 });

    expect(result).toEqual({
      status: 200,
      body: { type: 1 }
    });
  });

  it("rejects malformed interaction payloads", async () => {
    const result = await handleDiscordInteraction(null);

    expect(result).toEqual({
      status: 400,
      body: { error: "Invalid interaction payload." }
    });
  });

  it("returns an ephemeral error for unsupported commands", async () => {
    const result = await handleDiscordInteraction({
      type: 2,
      guild_id: "guild-1",
      channel_id: "channel-1",
      member: { user: { id: "user-1" }, roles: [] },
      data: { name: "unknown-command" }
    });

    expect(result).toEqual({
      status: 200,
      body: {
        type: 4,
        data: {
          content: "Unsupported command: unknown-command.",
          flags: DISCORD_EPHEMERAL_MESSAGE_FLAG
        }
      }
    });
  });

  it("returns an ephemeral error for server commands used outside a guild", async () => {
    const result = await handleDiscordInteraction({
      type: 2,
      data: { name: "incident" }
    });

    expect(result).toEqual({
      status: 200,
      body: {
        type: 4,
        data: {
          content: "This bot can only be used in a server.",
          flags: DISCORD_EPHEMERAL_MESSAGE_FLAG
        }
      }
    });
  });
});
