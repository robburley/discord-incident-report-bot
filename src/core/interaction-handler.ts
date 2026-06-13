export interface InteractionHandlerInput {
  readonly interaction: unknown;
}

export interface InteractionHandlerResult {
  readonly status: number;
  readonly body: unknown;
}

export function handleInteractionShell(
  input: InteractionHandlerInput
): InteractionHandlerResult {
  if (input.interaction === null || typeof input.interaction !== "object") {
    return {
      status: 400,
      body: { error: "Invalid interaction payload." }
    };
  }

  return {
    status: 200,
    body: { ok: true }
  };
}
