export type IncidentSessionStatus = "active" | "closed";

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
  readonly createdAt: number;
}

export interface UpsertGuildConfigInput {
  readonly guildId: string;
  readonly managerRoleId: string;
}

export interface CreateSessionInput {
  readonly guildId: string;
  readonly channelId: string;
  readonly startedByUserId: string;
}

export interface CloseSessionInput {
  readonly sessionId: string;
  readonly endedByUserId: string;
}

export interface InsertReportInput {
  readonly sessionId: string;
  readonly guildId: string;
  readonly submittedByUserId: string;
  readonly discordInteractionId: string;
  readonly raceNumber: number;
  readonly lapNumber: number;
  readonly turnNumber: number;
  readonly carNumber: string;
}

export interface DuplicateReportInput {
  readonly sessionId: string;
  readonly submittedByUserId: string;
  readonly raceNumber: number;
  readonly lapNumber: number;
  readonly turnNumber: number;
  readonly carNumber: string;
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

export class RepositoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryConflictError";
  }
}

export interface IncidentRepository {
  upsertGuildConfig(input: UpsertGuildConfigInput): Promise<GuildConfig>;
  getGuildConfig(guildId: string): Promise<GuildConfig | null>;
  getActiveSession(guildId: string): Promise<IncidentSession | null>;
  createSession(input: CreateSessionInput): Promise<IncidentSession>;
  closeSession(input: CloseSessionInput): Promise<IncidentSession | null>;
  insertReport(input: InsertReportInput): Promise<InsertReportResult>;
  getReportByDiscordInteractionId(
    discordInteractionId: string
  ): Promise<IncidentReport | null>;
  findDuplicateReportForUser(
    input: DuplicateReportInput
  ): Promise<IncidentReport | null>;
  getOrderedReportsForSession(sessionId: string): Promise<IncidentReport[]>;
  getLatestClosedSessionForGuild(guildId: string): Promise<IncidentSession | null>;
}
