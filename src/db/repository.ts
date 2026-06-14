export type IncidentSessionStatus =
  | "reporting"
  | "awaiting_stewards"
  | "stewarding"
  | "decided";

export interface GuildConfig {
  readonly guildId: string;
  readonly managerRoleId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface IncidentSession {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly startedByUserId: string;
  readonly endedByUserId: string | null;
  readonly status: IncidentSessionStatus;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly stewardingStartedByUserId: string | null;
  readonly stewardingCompletedByUserId: string | null;
  readonly lastReopenedByUserId: string | null;
  readonly stewardingStartedAt: number | null;
  readonly stewardingCompletedAt: number | null;
  readonly lastReopenedAt: number | null;
}

export interface IncidentReport {
  readonly id: string;
  readonly sessionId: string;
  readonly guildId: string;
  readonly submittedByUserId: string;
  readonly discordInteractionId: string;
  readonly raceNumber: number;
  readonly lapNumber: number;
  readonly turnNumber: number;
  readonly carNumber: string;
  readonly note: string | null;
  readonly createdAt: number;
}

export interface PenaltyPreset {
  readonly id: string;
  readonly guildId: string;
  readonly name: string;
  readonly outcome: string;
  readonly delta: number | null;
  readonly isActive: boolean;
  readonly createdByUserId: string;
  readonly deactivatedByUserId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deactivatedAt: number | null;
}

export interface Penalty {
  readonly id: string;
  readonly incidentSessionId: string;
  readonly incidentReportId: string;
  readonly affectedUserId: string;
  readonly penaltyPresetId: string;
  readonly outcome: string;
  readonly delta: number | null;
  readonly note: string | null;
  readonly createdByUserId: string;
  readonly updatedByUserId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface UpsertGuildConfigInput {
  readonly guildId: string;
  readonly managerRoleId: string;
}

export interface CreateReportingSessionInput {
  readonly guildId: string;
  readonly channelId: string;
  readonly startedByUserId: string;
}

export interface EndReportingSessionInput {
  readonly sessionId: string;
  readonly endedByUserId: string;
}

export interface StartStewardingSessionInput {
  readonly sessionId: string;
  readonly startedByUserId: string;
}

export interface CompleteStewardingSessionInput {
  readonly sessionId: string;
  readonly completedByUserId: string;
}

export interface ReopenStewardingSessionForReportingInput {
  readonly guildId: string;
  readonly reopenedByUserId: string;
}

export type ReopenStewardingSessionForReportingResult =
  | {
      readonly status: "reopened";
      readonly session: IncidentSession;
    }
  | {
      readonly status: "no_stewarding_session" | "penalties_exist";
      readonly session?: IncidentSession | undefined;
    };

export interface ReopenDecidedSessionForStewardingInput {
  readonly guildId: string;
  readonly reopenedByUserId: string;
}

export type ReopenDecidedSessionForStewardingResult =
  | {
      readonly status: "reopened";
      readonly session: IncidentSession;
    }
  | {
      readonly status: "no_decided_session" | "already_stewarding";
      readonly session?: IncidentSession | undefined;
    };

export interface InsertReportInput {
  readonly sessionId: string;
  readonly guildId: string;
  readonly submittedByUserId: string;
  readonly discordInteractionId: string;
  readonly raceNumber: number;
  readonly lapNumber: number;
  readonly turnNumber: number;
  readonly carNumber: string;
  readonly note?: string | null;
}

export interface DuplicateReportInput {
  readonly sessionId: string;
  readonly submittedByUserId: string;
  readonly raceNumber: number;
  readonly lapNumber: number;
  readonly turnNumber: number;
  readonly carNumber: string;
}

export interface CreatePenaltyPresetInput {
  readonly guildId: string;
  readonly name: string;
  readonly outcome: string;
  readonly delta: number | null;
  readonly createdByUserId: string;
}

export interface DeactivatePenaltyPresetInput {
  readonly presetId: string;
  readonly deactivatedByUserId: string;
}

export interface UpsertPenaltyInput {
  readonly incidentSessionId: string;
  readonly incidentReportId: string;
  readonly affectedUserId: string;
  readonly penaltyPresetId: string;
  readonly outcome: string;
  readonly delta: number | null;
  readonly note: string | null;
  readonly createdByUserId: string;
  readonly updatedByUserId: string;
}

export interface ClearPenaltiesForIncidentInput {
  readonly incidentSessionId: string;
  readonly incidentReportId: string;
}

export interface InsertProcessedDiscordInteractionInput {
  readonly interactionId: string;
  readonly guildId: string;
  readonly commandName: string;
  readonly subcommandName: string;
}

export interface IncrementInteractionRateLimitInput {
  readonly key: string;
  readonly guildId: string;
  readonly userId: string;
  readonly action: string;
  readonly windowSeconds: number;
  readonly limit: number;
}

export type InsertReportResult =
  | {
      readonly status: "inserted";
      readonly report: IncidentReport;
    }
  | {
      readonly status: "duplicate_interaction";
      readonly report: IncidentReport;
    };

export type UpsertPenaltyResult =
  | {
      readonly status: "inserted";
      readonly penalty: Penalty;
    }
  | {
      readonly status: "updated";
      readonly penalty: Penalty;
    };

export type InsertProcessedDiscordInteractionResult =
  | {
      readonly status: "inserted";
    }
  | {
      readonly status: "duplicate";
    };

export type IncrementInteractionRateLimitResult =
  | {
      readonly status: "allowed";
      readonly count: number;
    }
  | {
      readonly status: "limited";
      readonly count: number;
      readonly retryAfterSeconds: number;
    };

export interface PenaltyDecisionSummaryRow {
  readonly penalty: Penalty;
  readonly report: IncidentReport;
  readonly preset: PenaltyPreset | null;
}

export class RepositoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryConflictError";
  }
}

export interface IncidentRepository {
  upsertGuildConfig(input: UpsertGuildConfigInput): Promise<GuildConfig>;
  getGuildConfig(guildId: string): Promise<GuildConfig | null>;
  getReportingSessionForGuild(guildId: string): Promise<IncidentSession | null>;
  createReportingSession(
    input: CreateReportingSessionInput
  ): Promise<IncidentSession>;
  endReportingSession(
    input: EndReportingSessionInput
  ): Promise<IncidentSession | null>;
  insertReport(input: InsertReportInput): Promise<InsertReportResult>;
  getReportByDiscordInteractionId(
    discordInteractionId: string
  ): Promise<IncidentReport | null>;
  findDuplicateReportForUser(
    input: DuplicateReportInput
  ): Promise<IncidentReport | null>;
  getOrderedReportsForSession(sessionId: string): Promise<IncidentReport[]>;
  getLatestSessionAwaitingStewardsForGuild(
    guildId: string
  ): Promise<IncidentSession | null>;
  getStewardingSessionForGuild(guildId: string): Promise<IncidentSession | null>;
  getStewardingSessionForChannel(
    guildId: string,
    channelId: string
  ): Promise<IncidentSession | null>;
  startStewardingSession(
    input: StartStewardingSessionInput
  ): Promise<IncidentSession | null>;
  completeStewardingSession(
    input: CompleteStewardingSessionInput
  ): Promise<IncidentSession | null>;
  reopenStewardingSessionForReporting(
    input: ReopenStewardingSessionForReportingInput
  ): Promise<ReopenStewardingSessionForReportingResult>;
  reopenDecidedSessionForStewarding(
    input: ReopenDecidedSessionForStewardingInput
  ): Promise<ReopenDecidedSessionForStewardingResult>;
  getLatestIncidentSummarySessionForGuild(
    guildId: string
  ): Promise<IncidentSession | null>;
  getLatestDecidedSessionForGuild(
    guildId: string
  ): Promise<IncidentSession | null>;
  createPenaltyPreset(input: CreatePenaltyPresetInput): Promise<PenaltyPreset>;
  listPenaltyPresetsForGuild(guildId: string): Promise<PenaltyPreset[]>;
  searchPenaltyPresetsForGuild(
    guildId: string,
    query: string
  ): Promise<PenaltyPreset[]>;
  getActivePenaltyPresetForGuild(
    guildId: string,
    presetIdOrName: string
  ): Promise<PenaltyPreset | null>;
  deactivatePenaltyPreset(
    input: DeactivatePenaltyPresetInput
  ): Promise<PenaltyPreset | null>;
  upsertPenaltyForIncidentSession(
    input: UpsertPenaltyInput
  ): Promise<UpsertPenaltyResult>;
  clearPenaltiesForIncidentInSession(
    input: ClearPenaltiesForIncidentInput
  ): Promise<number>;
  getPenaltiesWithReportsForSession(
    sessionId: string
  ): Promise<PenaltyDecisionSummaryRow[]>;
  getReportForStewardingSessionByDiscordInteractionId(
    incidentSessionId: string,
    guildId: string,
    discordInteractionId: string
  ): Promise<IncidentReport | null>;
  insertProcessedDiscordInteraction(
    input: InsertProcessedDiscordInteractionInput
  ): Promise<InsertProcessedDiscordInteractionResult>;
  incrementInteractionRateLimit(
    input: IncrementInteractionRateLimitInput
  ): Promise<IncrementInteractionRateLimitResult>;
}
