export interface ManagerAuthorizationInput {
  readonly managerRoleId: string;
  readonly memberRoleIds: readonly string[];
}

export function hasManagerRole(input: ManagerAuthorizationInput): boolean {
  return input.memberRoleIds.includes(input.managerRoleId);
}
