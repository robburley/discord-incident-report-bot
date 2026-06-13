export interface DiscordRestClient {
  createChannelMessage(input: {
    readonly channelId: string;
    readonly content: string;
  }): Promise<void>;
}

export class FetchDiscordRestClient implements DiscordRestClient {
  constructor(
    private readonly botToken: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async createChannelMessage(input: {
    readonly channelId: string;
    readonly content: string;
  }): Promise<void> {
    const response = await this.fetchFn(
      `https://discord.com/api/v10/channels/${input.channelId}/messages`,
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
      throw new Error(`Discord REST message post failed with ${response.status}.`);
    }
  }
}
