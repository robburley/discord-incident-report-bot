export interface DiscordRestClient {
  createDmChannel(input: {
    readonly recipientId: string;
  }): Promise<{
    readonly channelId: string;
  }>;
  createChannelMessage(input: {
    readonly channelId: string;
    readonly content: string;
  }): Promise<void>;
  editOriginalInteractionResponse(input: {
    readonly applicationId: string;
    readonly interactionToken: string;
    readonly content: string;
  }): Promise<void>;
}

export class FetchDiscordRestClient implements DiscordRestClient {
  constructor(
    private readonly botToken: string
  ) {}

  async createDmChannel(input: {
    readonly recipientId: string;
  }): Promise<{
    readonly channelId: string;
  }> {
    console.log({
      event: "rest_client_create_dm_channel",
      recipientId: input.recipientId
    });
    const response = await fetch(
        new URL("https://discord.com/api/v10/users/@me/channels"),
        {
          method: "POST",
          headers: {
            authorization: `Bot ${this.botToken}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            recipient_id: input.recipientId
          })
        }
      );

    if (!response.ok) {
      throw new Error(
        `Discord REST DM channel creation failed with ${response.status}: ${await response.text()}`
      );
    }

    const body = await response.json();

    if (!isDmChannelResponse(body)) {
      throw new Error("Discord REST DM channel creation returned a malformed response.");
    }

    return { channelId: body.id };
  }

  async createChannelMessage(input: {
    readonly channelId: string;
    readonly content: string;
  }): Promise<void> {
    console.log({
      event: "rest_client_create_message",
      channelId: input.channelId,
      contentLength: input.content.length
    });
    const response = await fetch(
        new URL(`https://discord.com/api/v10/channels/${input.channelId}/messages`),
        {
          method: "POST",
          headers: {
            authorization: `Bot ${this.botToken}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            content: input.content
          })
        }
      );


    if (!response.ok) {
      throw new Error(
        `Discord REST message post failed with ${response.status}: ${await response.text()}`
      );
    }
  }

  async editOriginalInteractionResponse(input: {
    readonly applicationId: string;
    readonly interactionToken: string;
    readonly content: string;
  }): Promise<void> {
    console.log({
      event: "rest_client_edit_interaction_response",
      applicationId: input.applicationId,
      contentLength: input.content.length
    });
    const response = await fetch(
        new URL(`https://discord.com/api/v10/webhooks/${input.applicationId}/${input.interactionToken}/messages/@original`),
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            content: input.content
          })
        }
      );


    if (!response.ok) {
      throw new Error(
        `Discord REST interaction response edit failed with ${response.status}: ${await response.text()}`
      );
    }
  }
}

function isDmChannelResponse(body: unknown): body is { readonly id: string } {
  return (
    body !== null &&
    typeof body === "object" &&
    "id" in body &&
    typeof body.id === "string" &&
    body.id !== ""
  );
}
