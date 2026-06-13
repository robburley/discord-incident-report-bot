import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  PermissionFlagsBits
} from "discord-api-types/v10";
import type { RESTPutAPIApplicationGuildCommandsJSONBody } from "discord-api-types/v10";

export const INCIDENT_COMMAND_NAME = "incident";
export const INCIDENT_SESSION_COMMAND_NAME = "incident-session";
export const INCIDENT_CONFIG_COMMAND_NAME = "incident-config";

export const incidentCommands = [
  {
    name: INCIDENT_COMMAND_NAME,
    description: "Report an incident for the active race session.",
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
        description: "End the active incident reporting session.",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "summary",
        description: "Repost the latest closed incident session summary.",
        type: ApplicationCommandOptionType.Subcommand
      }
    ]
  },
  {
    name: INCIDENT_CONFIG_COMMAND_NAME,
    description: "Configure incident bot settings for this server.",
    type: ApplicationCommandType.ChatInput,
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
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
      }
    ]
  }
] satisfies RESTPutAPIApplicationGuildCommandsJSONBody;
