import type {
  IncidentReport,
  IncidentSession,
  PenaltyDecisionSummaryRow
} from "../db/repository";
import { escapeDiscordMentions } from "../discord/mentions";

export const DISCORD_MESSAGE_LIMIT = 2_000;

export interface FormatSessionSummaryInput {
  readonly session: IncidentSession;
  readonly reports: readonly IncidentReport[];
}

export interface FormatStewardingDecisionSummaryInput {
  readonly session: IncidentSession;
  readonly decisions: readonly PenaltyDecisionSummaryRow[];
}

const SUMMARY_TABLE_HEADERS = ["Race", "Lap", "Turn", "Car", "ID", "User"] as const;
const DECISION_TABLE_HEADERS = [
  "Race",
  "Lap",
  "Turn",
  "Car",
  "ID",
  "Outcome"
] as const;

export function formatSessionSummary(input: FormatSessionSummaryInput): string {
  const lines = [
    `Incident reporting ended for <#${input.session.channelId}>.`
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
    userMention: `<@${report.submittedByUserId}>`,
    note: report.note ? normalizeDiscordTableCell(report.note) : null
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
      (row) =>
        `\`${formatCells(row.cells)}\` ${row.userMention}${
          row.note ? ` ${row.note}` : ""
        }`
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

export function formatStewardingDecisionSummary(
  input: FormatStewardingDecisionSummaryInput
): string {
  const lines = [
    `Stewarding decisions for <#${input.session.channelId}>.`
  ];

  if (input.decisions.length === 0) {
    lines.push("No penalties were assigned.");
    return lines.join("\n");
  }

  lines.push("", ...formatDecisionTable(input.decisions));

  return lines.join("\n");
}

export function formatSplitStewardingDecisionSummary(
  input: FormatStewardingDecisionSummaryInput,
  limit = DISCORD_MESSAGE_LIMIT
): string[] {
  return splitDiscordMessage(formatStewardingDecisionSummary(input), limit);
}

function formatDecisionTable(
  decisions: readonly PenaltyDecisionSummaryRow[]
): string[] {
  const rows = decisions.map(({ penalty, report }) => ({
    cells: [
      report.raceNumber.toString(),
      report.lapNumber.toString(),
      report.turnNumber.toString(),
      report.carNumber,
      report.discordInteractionId,
      normalizeDiscordTableCell(penalty.outcome)
    ],
    affectedUserMention: `<@${penalty.affectedUserId}>`
  }));
  const widths = DECISION_TABLE_HEADERS.map((header, columnIndex) =>
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
    `\`${formatCells(DECISION_TABLE_HEADERS)}\``,
    ...rows.map(
      (row) => `\`${formatCells(row.cells)}\` ${row.affectedUserMention}`
    )
  ];
}

function normalizeDiscordTableCell(value: string): string {
  return escapeDiscordMentions(value)
    .replace(/`/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
