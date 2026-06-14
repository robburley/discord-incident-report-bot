import { afterEach, describe, expect, it, vi } from "vitest";

import { FetchDiscordRestClient } from "../../src/discord/rest";

describe("Discord REST client logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not log bot tokens, interaction tokens, or message content", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "dm-channel-1" }), { status: 200 }))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new FetchDiscordRestClient("bot-token-that-must-not-log");

    await client.createDmChannel({
      recipientId: "recipient-1"
    });
    await client.createChannelMessage({
      channelId: "channel-1",
      content: "message-content-that-must-not-log"
    });
    await client.editOriginalInteractionResponse({
      applicationId: "app-1",
      interactionToken: "interaction-token-that-must-not-log",
      content: "edit-content-that-must-not-log"
    });

    const logged = JSON.stringify(logSpy.mock.calls);

    expect(logged).not.toContain("bot-token-that-must-not-log");
    expect(logged).not.toContain("interaction-token-that-must-not-log");
    expect(logged).not.toContain("message-content-that-must-not-log");
    expect(logged).not.toContain("edit-content-that-must-not-log");
    expect(logged).toContain("contentLength");
  });
});

describe("FetchDiscordRestClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a DM channel for a recipient", async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ id: "dm-channel-1" }),
      { status: 200 }
    ));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new FetchDiscordRestClient("bot-token");

    await expect(
      client.createDmChannel({ recipientId: "user-1" })
    ).resolves.toEqual({ channelId: "dm-channel-1" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      new URL("https://discord.com/api/v10/users/@me/channels"),
      {
        method: "POST",
        headers: {
          authorization: "Bot bot-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          recipient_id: "user-1"
        })
      }
    );
  });

  it("posts channel messages through the same endpoint used for DM channels", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new FetchDiscordRestClient("bot-token");

    await client.createChannelMessage({
      channelId: "dm-channel-1",
      content: "Guide chunk"
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      new URL("https://discord.com/api/v10/channels/dm-channel-1/messages"),
      {
        method: "POST",
        headers: {
          authorization: "Bot bot-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          content: "Guide chunk",
          allowed_mentions: {
            parse: [],
            users: [],
            roles: [],
            replied_user: false
          }
        })
      }
    );
  });

  it("rejects failed DM channel creation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("blocked", { status: 403 }))
    );

    const client = new FetchDiscordRestClient("bot-token");

    await expect(
      client.createDmChannel({ recipientId: "user-1" })
    ).rejects.toThrow("Discord REST DM channel creation failed with 403");
  });

  it("sanitizes upstream Discord error bodies before throwing", async () => {
    const token = "aaaaaaaaaaaaaaaaaaaa.bbbbbb.cccccccccccccccccccc";
    const oversizedBody = [
      `authorization: Bot ${token}`,
      `trace token ${token}`,
      "original-message-content",
      "x".repeat(500)
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(oversizedBody, { status: 429 }))
    );

    const client = new FetchDiscordRestClient("bot-token");

    let thrown: unknown;
    try {
      await client.createChannelMessage({
        channelId: "channel-1",
        content: "original-message-content"
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = thrown instanceof Error ? thrown.message : "";

    expect(message).toContain("Discord REST message post failed with 429");
    expect(message).toContain("Bot [redacted]");
    expect(message).toContain("[redacted-token]");
    expect(message).not.toContain(token);
    expect(message).not.toContain("original-message-content");
    expect(message).not.toContain("\n");
    expect(message.length).toBeLessThanOrEqual(
      "Discord REST message post failed with 429: ".length + 300
    );
  });

  it("sanitizes interaction response edit failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          "webhook token zzzzzzzzzzzzzzzzzzzz.yyyyyy.xxxxxxxxxxxxxxxxxxxx",
          { status: 401 }
        )
      )
    );

    const client = new FetchDiscordRestClient("bot-token");

    await expect(
      client.editOriginalInteractionResponse({
        applicationId: "app-1",
        interactionToken: "interaction-token-that-must-not-log",
        content: "edit-content-that-must-not-log"
      })
    ).rejects.toThrow(
      "Discord REST interaction response edit failed with 401: webhook token [redacted-token]"
    );
  });
});
