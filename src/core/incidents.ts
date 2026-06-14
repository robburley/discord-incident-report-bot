import type {
  IncidentReport,
  IncidentRepository
} from "../db/repository";
import { INCIDENT_SETUP_MESSAGE } from "./config";

const CAR_NUMBER_PATTERN = /^[A-Za-z0-9_-]{1,12}$/;

export interface IncidentReportFields {
  readonly raceNumber: unknown;
  readonly lapNumber: unknown;
  readonly turnNumber: unknown;
  readonly carNumber: unknown;
}

export interface ValidatedIncidentReportFields {
  readonly raceNumber: number;
  readonly lapNumber: number;
  readonly turnNumber: number;
  readonly carNumber: string;
}

export type IncidentReportValidationResult =
  | {
      readonly status: "valid";
      readonly value: ValidatedIncidentReportFields;
    }
  | {
      readonly status: "invalid";
      readonly message: string;
    };

export interface CreateIncidentReportInput extends IncidentReportFields {
  readonly repository: IncidentRepository;
  readonly guildId: string;
  readonly channelId?: string;
  readonly submittedByUserId: string;
  readonly discordInteractionId: string;
}

export type CreateIncidentReportResult =
  | {
      readonly status: "created" | "duplicate_interaction";
      readonly report: IncidentReport;
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "no_reporting_session"
        | "wrong_channel"
        | "invalid_report"
        | "duplicate_report";
      readonly message: string;
      readonly report?: IncidentReport;
    };

export function validateIncidentReportFields(
  input: IncidentReportFields
): IncidentReportValidationResult {
  const raceNumber = parsePositiveInteger(input.raceNumber, "Race number");
  if (typeof raceNumber === "string") {
    return invalid(raceNumber);
  }

  const lapNumber = parsePositiveInteger(input.lapNumber, "Lap number");
  if (typeof lapNumber === "string") {
    return invalid(lapNumber);
  }

  const turnNumber = parsePositiveInteger(input.turnNumber, "Turn / corner number");
  if (typeof turnNumber === "string") {
    return invalid(turnNumber);
  }

  if (typeof input.carNumber !== "string") {
    return invalid(
      "Car number must contain only letters, numbers, hyphens, and underscores."
    );
  }

  const carNumber = input.carNumber.trim();

  if (!CAR_NUMBER_PATTERN.test(carNumber)) {
    return invalid(
      "Car number must be 1-12 characters using only letters, numbers, hyphens, and underscores."
    );
  }

  return {
    status: "valid",
    value: {
      raceNumber,
      lapNumber,
      turnNumber,
      carNumber
    }
  };
}

export async function createIncidentReport(
  input: CreateIncidentReportInput
): Promise<CreateIncidentReportResult> {
  const config = await input.repository.getGuildConfig(input.guildId);

  if (!config) {
    return {
      status: "guild_not_configured",
      message: INCIDENT_SETUP_MESSAGE
    };
  }

  const reportingSession = await input.repository.getReportingSessionForGuild(
    input.guildId
  );

  if (!reportingSession) {
    return {
      status: "no_reporting_session",
      message: "There is no reporting incident session."
    };
  }

  if (
    input.channelId !== undefined &&
    input.channelId !== reportingSession.channelId
  ) {
    return {
      status: "wrong_channel",
      message: "Incidents can only be reported in the reporting session channel."
    };
  }

  const validation = validateIncidentReportFields(input);

  if (validation.status === "invalid") {
    return {
      status: "invalid_report",
      message: validation.message
    };
  }

  const existingInteraction =
    await input.repository.getReportByDiscordInteractionId(
      input.discordInteractionId
    );

  if (existingInteraction) {
    return {
      status: "duplicate_interaction",
      report: existingInteraction
    };
  }

  const duplicate = await input.repository.findDuplicateReportForUser({
    sessionId: reportingSession.id,
    submittedByUserId: input.submittedByUserId,
    ...validation.value
  });

  if (duplicate) {
    return {
      status: "duplicate_report",
      message: "You have already submitted that exact incident report.",
      report: duplicate
    };
  }

  const inserted = await input.repository.insertReport({
    sessionId: reportingSession.id,
    guildId: input.guildId,
    submittedByUserId: input.submittedByUserId,
    discordInteractionId: input.discordInteractionId,
    ...validation.value
  });

  return {
    status: inserted.status === "inserted" ? "created" : "duplicate_interaction",
    report: inserted.report
  };
}

function parsePositiveInteger(value: unknown, label: string): number | string {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < 1) {
    return `${label} must be a positive integer.`;
  }

  return parsed;
}

function invalid(message: string): IncidentReportValidationResult {
  return {
    status: "invalid",
    message
  };
}
