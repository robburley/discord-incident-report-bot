export function escapeDiscordMentions(value: string): string {
  return value.replace(/@(?=everyone\b|here\b|[!&]?\d{5,})/g, "@\u200b");
}
