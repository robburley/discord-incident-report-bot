import type { GuildConfig, IncidentRepository } from "../db/repository";

export const INCIDENT_SETUP_MESSAGE =
  "This server is not configured yet. A server admin must run `/incident-config role role:<manager role>` before incident commands can be used.";

export interface ConfigureGuildManagerRoleInput {
  readonly repository: IncidentRepository;
  readonly guildId: string;
  readonly managerRoleId: string;
}

export type ConfigureGuildManagerRoleResult =
  | {
      readonly status: "configured";
      readonly config: GuildConfig;
    }
  | {
      readonly status: "invalid_role";
      readonly message: string;
    };

export interface GetGuildConfigStatusInput {
  readonly repository: IncidentRepository;
  readonly guildId: string;
}

export type GetGuildConfigStatusResult =
  | {
      readonly status: "configured";
      readonly config: GuildConfig;
      readonly message: string;
    }
  | {
      readonly status: "not_configured";
      readonly message: string;
    };

export async function configureGuildManagerRole(
  input: ConfigureGuildManagerRoleInput
): Promise<ConfigureGuildManagerRoleResult> {
  const managerRoleId = input.managerRoleId.trim();

  if (managerRoleId.length === 0) {
    return {
      status: "invalid_role",
      message: "Choose a manager role before configuring incidents."
    };
  }

  const config = await input.repository.upsertGuildConfig({
    guildId: input.guildId,
    managerRoleId
  });

  return {
    status: "configured",
    config
  };
}

export async function getGuildConfigStatus(
  input: GetGuildConfigStatusInput
): Promise<GetGuildConfigStatusResult> {
  const config = await input.repository.getGuildConfig(input.guildId);

  if (!config) {
    return {
      status: "not_configured",
      message: `No incident manager role is configured. ${INCIDENT_SETUP_MESSAGE}`
    };
  }

  return {
    status: "configured",
    config,
    message: `Incident bot is configured. Manager role: <@&${config.managerRoleId}>.`
  };
}
