import { afterEach, describe, expect, it, vi } from "vitest";

import { FetchDiscordRestClient } from "../../src/discord/rest";

describe("Discord REST client logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not log bot tokens, interaction tokens, or message content", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new FetchDiscordRestClient("bot-token-that-must-not-log");

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
