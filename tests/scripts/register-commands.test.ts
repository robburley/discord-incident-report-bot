import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getRegistrationUsage,
  parseRegistrationScope,
  registerCommands
} from "../../scripts/register-commands";

describe("register-commands script", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses explicit registration scopes", () => {
    expect(parseRegistrationScope(["--scope", "guild"])).toBe("guild");
    expect(parseRegistrationScope(["--scope=global"])).toBe("global");
    expect(parseRegistrationScope(["--help"])).toBe("help");
  });

  it("prints guidance for the default command path", () => {
    expect(getRegistrationUsage()).toContain("register:commands:guild");
    expect(getRegistrationUsage()).toContain("register:commands:global");
  });

  it("registers guild commands to the configured test guild", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => new Response("[]", { status: 200 }));

    await registerCommands({
      env: {
        DISCORD_APPLICATION_ID: "app-1",
        DISCORD_BOT_TOKEN: "bot-token",
        DISCORD_TEST_GUILD_ID: "guild-1"
      },
      scope: "guild",
      fetchImpl: fetchSpy
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://discord.com/api/v10/applications/app-1/guilds/guild-1/commands",
      expect.objectContaining({ method: "PUT" })
    );
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "discord_guild_commands_registered",
      commandScope: "guild",
      guildId: "guild-1",
      commandCount: 3
    });
  });

  it("registers global commands without requiring a test guild id", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => new Response("[]", { status: 200 }));

    await registerCommands({
      env: {
        DISCORD_APPLICATION_ID: "app-1",
        DISCORD_BOT_TOKEN: "bot-token"
      },
      scope: "global",
      fetchImpl: fetchSpy
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://discord.com/api/v10/applications/app-1/commands",
      expect.objectContaining({ method: "PUT" })
    );
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "discord_global_commands_registered",
      commandScope: "global",
      commandCount: 3
    });
  });

  it("requires the test guild id only for guild registration", async () => {
    const fetchSpy = vi.fn(async () => new Response("[]", { status: 200 }));

    await expect(
      registerCommands({
        env: {
          DISCORD_APPLICATION_ID: "app-1",
          DISCORD_BOT_TOKEN: "bot-token"
        },
        scope: "guild",
        fetchImpl: fetchSpy
      })
    ).rejects.toThrow("DISCORD_TEST_GUILD_ID");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires application id and bot token for every registration scope", async () => {
    await expect(
      registerCommands({
        env: {},
        scope: "global",
        fetchImpl: vi.fn()
      })
    ).rejects.toThrow("DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN");
  });
});
