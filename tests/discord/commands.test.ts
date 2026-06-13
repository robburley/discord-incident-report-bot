import {
  type APIApplicationCommandBasicOption,
  type APIApplicationCommandSubcommandOption,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  PermissionFlagsBits
} from "discord-api-types/v10";
import { describe, expect, it } from "vitest";

import { incidentCommands } from "../../src/discord/commands";

describe("incidentCommands", () => {
  it("defines the top-level slash commands", () => {
    expect(incidentCommands.map((command) => command.name)).toEqual([
      "incident",
      "incident-session",
      "incident-config"
    ]);

    for (const command of incidentCommands) {
      expect(command.type).toBe(ApplicationCommandType.ChatInput);
      expect(command.description.length).toBeGreaterThan(0);
    }
  });

  it("defines incident-session start, end, and summary subcommands", () => {
    const sessionCommand = incidentCommands.find(
      (command) => command.name === "incident-session"
    );

    expect(sessionCommand?.options?.map((option) => option.name)).toEqual([
      "start",
      "end",
      "summary"
    ]);
    expect(
      sessionCommand?.options?.every(
        (option) => option.type === ApplicationCommandOptionType.Subcommand
      )
    ).toBe(true);
  });

  it("defines incident-config role and status subcommands", () => {
    const configCommand = incidentCommands.find(
      (command) => command.name === "incident-config"
    );
    const roleSubcommand = configCommand?.options?.find(
      (option) => option.name === "role"
    ) as APIApplicationCommandSubcommandOption | undefined;
    const roleOption = roleSubcommand?.options?.find(
      (option) => option.name === "role"
    ) as APIApplicationCommandBasicOption | undefined;

    expect(configCommand?.default_member_permissions).toBe(
      PermissionFlagsBits.ManageGuild.toString()
    );
    expect(configCommand?.options?.map((option) => option.name)).toEqual([
      "role",
      "status"
    ]);
    expect(roleSubcommand?.type).toBe(ApplicationCommandOptionType.Subcommand);
    expect(roleOption).toMatchObject({
      name: "role",
      type: ApplicationCommandOptionType.Role,
      required: true
    });
    expect(
      configCommand?.options?.find((option) => option.name === "status")?.type
    ).toBe(ApplicationCommandOptionType.Subcommand);
  });
});
