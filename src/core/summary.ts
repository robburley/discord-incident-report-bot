import type { IncidentReport, IncidentSession } from "../db/repository";

export const DISCORD_MESSAGE_LIMIT = 2_000;

export interface FormatSessionSummaryInput {
  readonly session: IncidentSession;
  readonly reports: readonly IncidentReport[];
}

export function formatSessionSummary(input: FormatSessionSummaryInput): string {
  const lines = [
    `Incident session closed for channel ${input.session.channelId}.`
  ];

  if (input.reports.length === 0) {
    lines.push("No incidents were reported.");
    return lines.join("\n");
  }

  let currentRace: number | null = null;
  let currentLap: number | null = null;

  for (const report of input.reports) {
    if (report.raceNumber !== currentRace) {
      currentRace = report.raceNumber;
      currentLap = null;
      lines.push("", `Race ${report.raceNumber}`);
    }

    if (report.lapNumber !== currentLap) {
      currentLap = report.lapNumber;
      lines.push(`Lap ${report.lapNumber}`);
    }

    lines.push(
      `Turn ${report.turnNumber}: car ${report.carNumber} reported by ${report.submittedByUserId}`
    );
  }

  return lines.join("\n");
}

export function splitDiscordMessage(
  message: string,
  limit = DISCORD_MESSAGE_LIMIT
): string[] {
  if (limit < 1) {
    throw new Error("Discord message limit must be positive.");
  }

  const chunks: string[] = [];
  let current = "";

  for (const line of message.split("\n")) {
    const pending = current.length === 0 ? line : `${current}\n${line}`;

    if (pending.length <= limit) {
      current = pending;
      continue;
    }

    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }

    if (line.length <= limit) {
      current = line;
      continue;
    }

    for (let index = 0; index < line.length; index += limit) {
      chunks.push(line.slice(index, index + limit));
    }
  }

  if (current.length > 0 || chunks.length === 0) {
    chunks.push(current);
  }

  return chunks;
}

export function formatSplitSessionSummary(
  input: FormatSessionSummaryInput,
  limit = DISCORD_MESSAGE_LIMIT
): string[] {
  return splitDiscordMessage(formatSessionSummary(input), limit);
}
