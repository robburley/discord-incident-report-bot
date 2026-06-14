export interface ManagerAuthorizationInput {
  readonly managerRoleId: string;
  readonly memberRoleIds: readonly string[];
  readonly canManageGuild?: boolean;
}

export function hasIncidentManagerPermission(
  input: ManagerAuthorizationInput
): boolean {
  return (
    input.canManageGuild === true ||
    input.memberRoleIds.includes(input.managerRoleId)
  );
}
