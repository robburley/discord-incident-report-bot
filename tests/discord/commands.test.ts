import {
  type APIApplicationCommandBasicOption,
  type APIApplicationCommandSubcommandOption,
  ApplicationCommandOptionType,
  ApplicationCommandType
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

  it("defines incident-session workflow subcommands", () => {
    const sessionCommand = incidentCommands.find(
      (command) => command.name === "incident-session"
    );

    expect(sessionCommand?.options?.map((option) => option.name)).toEqual([
      "start",
      "summary",
      "steward",
      "penalty",
      "penalty-clear",
      "complete",
      "reopen-reporting",
      "reopen-stewarding",
      "decisions"
    ]);
    expect(
      sessionCommand?.options?.every(
        (option) => option.type === ApplicationCommandOptionType.Subcommand
      )
    ).toBe(true);
  });

  it("keeps incident-session recovery and stewarding utility subcommands", () => {
    const sessionCommand = incidentCommands.find(
      (command) => command.name === "incident-session"
    );
    const subcommandNames =
      sessionCommand?.options?.map((option) => option.name) ?? [];

    expect(subcommandNames).not.toContain("end");
    expect(subcommandNames).toEqual(
      expect.arrayContaining([
        "summary",
        "decisions",
        "penalty-clear",
        "reopen-reporting",
        "reopen-stewarding"
      ])
    );
  });

  it("describes steward as closing reporting and starting stewarding", () => {
    const sessionCommand = incidentCommands.find(
      (command) => command.name === "incident-session"
    );
    const stewardSubcommand = sessionCommand?.options?.find(
      (option) => option.name === "steward"
    );

    expect(stewardSubcommand?.description).toMatch(/close reporting/i);
    expect(stewardSubcommand?.description).toMatch(/start stewarding/i);
  });

  it("defines incident-session penalty options", () => {
    const sessionCommand = incidentCommands.find(
      (command) => command.name === "incident-session"
    );
    const penaltySubcommand = sessionCommand?.options?.find(
      (option) => option.name === "penalty"
    ) as APIApplicationCommandSubcommandOption | undefined;
    const penaltyClearSubcommand = sessionCommand?.options?.find(
      (option) => option.name === "penalty-clear"
    ) as APIApplicationCommandSubcommandOption | undefined;

    expect(penaltySubcommand?.options).toMatchObject([
      {
        name: "incident-id",
        type: ApplicationCommandOptionType.String,
        required: true
      },
      {
        name: "affected-user",
        type: ApplicationCommandOptionType.User,
        required: true
      },
      {
        name: "penalty",
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true
      },
      {
        name: "note",
        type: ApplicationCommandOptionType.String
      }
    ]);
    expect(penaltyClearSubcommand?.options).toMatchObject([
      {
        name: "incident-id",
        type: ApplicationCommandOptionType.String,
        required: true
      }
    ]);
  });

  it("defines incident-config role, status, and penalty preset subcommands", () => {
    const configCommand = incidentCommands.find(
      (command) => command.name === "incident-config"
    );
    const roleSubcommand = configCommand?.options?.find(
      (option) => option.name === "role"
    ) as APIApplicationCommandSubcommandOption | undefined;
    const roleOption = roleSubcommand?.options?.find(
      (option) => option.name === "role"
    ) as APIApplicationCommandBasicOption | undefined;
    const penaltyAddSubcommand = configCommand?.options?.find(
      (option) => option.name === "penalty-add"
    ) as APIApplicationCommandSubcommandOption | undefined;
    const penaltyRemoveSubcommand = configCommand?.options?.find(
      (option) => option.name === "penalty-remove"
    ) as APIApplicationCommandSubcommandOption | undefined;

    expect(configCommand).not.toHaveProperty("default_member_permissions");
    expect(configCommand?.options?.map((option) => option.name)).toEqual([
      "role",
      "status",
      "help",
      "penalty-add",
      "penalty-remove",
      "penalties"
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
    expect(
      configCommand?.options?.find((option) => option.name === "help")?.type
    ).toBe(ApplicationCommandOptionType.Subcommand);
    expect(penaltyAddSubcommand?.options).toMatchObject([
      {
        name: "name",
        type: ApplicationCommandOptionType.String,
        required: true
      },
      {
        name: "outcome",
        type: ApplicationCommandOptionType.String,
        required: true
      },
      {
        name: "delta",
        type: ApplicationCommandOptionType.Integer
      }
    ]);
    expect(penaltyRemoveSubcommand?.options).toMatchObject([
      {
        name: "penalty",
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true
      }
    ]);
    expect(
      configCommand?.options?.find((option) => option.name === "penalties")?.type
    ).toBe(ApplicationCommandOptionType.Subcommand);
  });
});
