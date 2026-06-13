import type { IncidentReport, IncidentSession } from "../db/repository";

export const DISCORD_MESSAGE_LIMIT = 2_000;

export interface FormatSessionSummaryInput {
  readonly session: IncidentSession;
  readonly reports: readonly IncidentReport[];
}

const SUMMARY_TABLE_HEADERS = ["Race", "Lap", "Turn", "Car", "ID", "User"] as const;

export function formatSessionSummary(input: FormatSessionSummaryInput): string {
  const lines = [
    `Incident session closed for <#${input.session.channelId}>.`
  ];

  if (input.reports.length === 0) {
    lines.push("No incidents were reported.");
    return lines.join("\n");
  }

  lines.push("", ...formatIncidentTable(input.reports));

  return lines.join("\n");
}

function formatIncidentTable(reports: readonly IncidentReport[]): string[] {
  const rows = reports.map((report) => ({
    cells: [
      report.raceNumber.toString(),
      report.lapNumber.toString(),
      report.turnNumber.toString(),
      report.carNumber,
      report.discordInteractionId
    ],
    userMention: `<@${report.submittedByUserId}>`
  }));
  const widths = SUMMARY_TABLE_HEADERS.map((header, columnIndex) =>
    Math.max(
      header.length,
      ...rows.map((row) => row.cells[columnIndex]?.length ?? 0)
    )
  );
  const formatCells = (cells: readonly string[]) =>
    cells
      .map((cell, columnIndex) => cell.padEnd(widths[columnIndex] ?? 0))
      .join("  ");

  return [
    `\`${formatCells(SUMMARY_TABLE_HEADERS)}\``,
    ...rows.map(
      (row) => `\`${formatCells(row.cells)}\` ${row.userMention}`
    )
  ];
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
