export interface JsonResponseBody {
  readonly [key: string]: unknown;
}

export const DISCORD_EPHEMERAL_MESSAGE_FLAG = 64;

export interface DiscordInteractionResponse {
  readonly type: number;
  readonly data?: {
    readonly content?: string;
    readonly flags?: number;
    readonly custom_id?: string;
    readonly title?: string;
    readonly components?: readonly DiscordComponent[];
  };
}

export interface DiscordComponent {
  readonly type: number;
  readonly custom_id?: string;
  readonly label?: string;
  readonly style?: number;
  readonly min_length?: number;
  readonly max_length?: number;
  readonly required?: boolean;
  readonly components?: readonly DiscordComponent[];
}

export function jsonResponse(body: JsonResponseBody, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers
    }
  });
}

export function discordPongResponse(): DiscordInteractionResponse {
  return { type: 1 };
}

export function ephemeralDiscordMessage(
  content: string
): DiscordInteractionResponse {
  return {
    type: 4,
    data: {
      content,
      flags: DISCORD_EPHEMERAL_MESSAGE_FLAG
    }
  };
}

export function publicDiscordMessage(content: string): DiscordInteractionResponse {
  return {
    type: 4,
    data: {
      content
    }
  };
}

export function deferredEphemeralDiscordMessage(): DiscordInteractionResponse {
  return {
    type: 5,
    data: {
      flags: DISCORD_EPHEMERAL_MESSAGE_FLAG
    }
  };
}

export function modalDiscordResponse(input: {
  readonly customId: string;
  readonly title: string;
  readonly components: readonly DiscordComponent[];
}): DiscordInteractionResponse {
  return {
    type: 9,
    data: {
      custom_id: input.customId,
      title: input.title,
      components: input.components
    }
  };
}
