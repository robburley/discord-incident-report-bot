import type { GuildConfig, IncidentRepository } from "../db/repository";

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
