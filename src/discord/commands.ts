import {
  ApplicationCommandOptionType,
  ApplicationCommandType
} from "discord-api-types/v10";
import type { RESTPutAPIApplicationGuildCommandsJSONBody } from "discord-api-types/v10";

export const INCIDENT_COMMAND_NAME = "incident";
export const INCIDENT_SESSION_COMMAND_NAME = "incident-session";
export const INCIDENT_CONFIG_COMMAND_NAME = "incident-config";

export const incidentCommands = [
  {
    name: INCIDENT_COMMAND_NAME,
    description: "Report an incident for the reporting session.",
    type: ApplicationCommandType.ChatInput
  },
  {
    name: INCIDENT_SESSION_COMMAND_NAME,
    description: "Manage race incident reporting sessions.",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "start",
        description: "Start an incident reporting session in this channel.",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "end",
        description: "End reporting and move the session to stewarding prep.",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "summary",
        description: "Repost the latest incident report summary.",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "steward",
        description: "Start stewarding for the latest session awaiting stewards.",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "penalty",
        description: "Record or update a penalty decision for an incident.",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "incident-id",
            description: "The incident ID from the report summary.",
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: "affected-user",
            description: "The driver receiving this penalty decision.",
            type: ApplicationCommandOptionType.User,
            required: true
          },
          {
            name: "penalty",
            description: "The configured penalty preset to apply.",
            type: ApplicationCommandOptionType.String,
            required: true,
            autocomplete: true
          },
          {
            name: "note",
            description: "Optional steward note for this decision.",
            type: ApplicationCommandOptionType.String
          }
        ]
      },
      {
        name: "penalty-clear",
        description: "Clear all penalty decisions for an incident.",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "incident-id",
            description: "The incident ID from the report summary.",
            type: ApplicationCommandOptionType.String,
            required: true
          }
        ]
      },
      {
        name: "complete",
        description: "Complete stewarding and post the decision summary.",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "reopen-reporting",
        description: "Reopen the latest session awaiting stewards for reports.",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "reopen-stewarding",
        description: "Reopen the latest decided session for stewarding updates.",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "decisions",
        description: "Repost the latest stewarding decision summary.",
        type: ApplicationCommandOptionType.Subcommand
      }
    ]
  },
  {
    name: INCIDENT_CONFIG_COMMAND_NAME,
    description: "Configure incident bot settings for this server.",
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: "role",
        description: "Set the manager role allowed to control incident sessions.",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "role",
            description: "The Discord role allowed to manage incident sessions.",
            type: ApplicationCommandOptionType.Role,
            required: true
          }
        ]
      },
      {
        name: "status",
        description: "Show this server's incident bot configuration status.",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "help",
        description: "DM the steward guide for managing incident sessions.",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "penalty-add",
        description: "Add a penalty preset for stewarding decisions.",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "name",
            description: "Short preset name shown in autocomplete.",
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: "outcome",
            description: "Decision text shown in stewarding summaries.",
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: "delta",
            description: "Optional numeric change such as points or seconds.",
            type: ApplicationCommandOptionType.Integer
          }
        ]
      },
      {
        name: "penalty-remove",
        description: "Remove a configured penalty preset.",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "penalty",
            description: "The configured penalty preset to remove.",
            type: ApplicationCommandOptionType.String,
            required: true,
            autocomplete: true
          }
        ]
      },
      {
        name: "penalties",
        description: "List configured penalty presets for this server.",
        type: ApplicationCommandOptionType.Subcommand
      }
    ]
  }
] satisfies RESTPutAPIApplicationGuildCommandsJSONBody;
