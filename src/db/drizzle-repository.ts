import { and, desc, eq } from "drizzle-orm";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";

import {
  guildConfigs,
  incidentReports,
  incidentSessions
} from "./schema";
import type {
  CloseSessionInput,
  CreateSessionInput,
  DuplicateReportInput,
  GuildConfig,
  IncidentReport,
  IncidentRepository,
  IncidentSession,
  InsertReportInput,
  InsertReportResult,
  UpsertGuildConfigInput
} from "./repository";
import { RepositoryConflictError } from "./repository";

export class DrizzleIncidentRepository implements IncidentRepository {
  constructor(
    // D1 and better-sqlite3 use different Drizzle database types, but this
    // repository only uses the shared SQLite query-builder surface.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly db: any,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = () => crypto.randomUUID()
  ) {}

  async upsertGuildConfig(input: UpsertGuildConfigInput): Promise<GuildConfig> {
    const existing = await this.getGuildConfig(input.guildId);
    const now = this.now();
    const createdAt = existing?.createdAt ?? now;

    const [row] = await this.db
      .insert(guildConfigs)
      .values({
        guildId: input.guildId,
        managerRoleId: input.managerRoleId,
        createdAt,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: guildConfigs.guildId,
        set: {
          managerRoleId: input.managerRoleId,
          updatedAt: now
        }
      })
      .returning();

    return requireRow(row, "Guild config upsert did not return a row.");
  }

  async getGuildConfig(guildId: string): Promise<GuildConfig | null> {
    const [row] = await this.db
      .select()
      .from(guildConfigs)
      .where(eq(guildConfigs.guildId, guildId))
      .limit(1);

    return (row as GuildConfig | undefined) ?? null;
  }

  async getActiveSession(guildId: string): Promise<IncidentSession | null> {
    const [row] = await this.db
      .select()
      .from(incidentSessions)
      .where(
        and(
          eq(incidentSessions.guildId, guildId),
          eq(incidentSessions.status, "active")
        )
      )
      .limit(1);

    return (row as IncidentSession | undefined) ?? null;
  }

  async createSession(input: CreateSessionInput): Promise<IncidentSession> {
    const activeSession = await this.getActiveSession(input.guildId);

    if (activeSession) {
      throw new RepositoryConflictError(
        `Guild ${input.guildId} already has an active incident session.`
      );
    }

    const [row] = await this.db
      .insert(incidentSessions)
      .values({
        id: this.createId(),
        guildId: input.guildId,
        channelId: input.channelId,
        startedByUserId: input.startedByUserId,
        endedByUserId: null,
        status: "active",
        startedAt: this.now(),
        endedAt: null
      })
      .returning();

    return requireRow(row, "Session insert did not return a row.");
  }

  async closeSession(input: CloseSessionInput): Promise<IncidentSession | null> {
    const [row] = await this.db
      .update(incidentSessions)
      .set({
        endedByUserId: input.endedByUserId,
        status: "closed",
        endedAt: this.now()
      })
      .where(
        and(
          eq(incidentSessions.id, input.sessionId),
          eq(incidentSessions.status, "active")
        )
      )
      .returning();

    return (row as IncidentSession | undefined) ?? null;
  }

  async insertReport(input: InsertReportInput): Promise<InsertReportResult> {
    const existingInteraction = await this.getReportByDiscordInteractionId(
      input.discordInteractionId
    );

    if (existingInteraction) {
      return {
        status: "duplicate_interaction",
        report: existingInteraction
      };
    }

    const [row] = await this.db
      .insert(incidentReports)
      .values({
        id: this.createId(),
        sessionId: input.sessionId,
        guildId: input.guildId,
        submittedByUserId: input.submittedByUserId,
        discordInteractionId: input.discordInteractionId,
        raceNumber: input.raceNumber,
        lapNumber: input.lapNumber,
        turnNumber: input.turnNumber,
        carNumber: input.carNumber,
        createdAt: this.now()
      })
      .returning();

    return {
      status: "inserted",
      report: requireRow(row, "Report insert did not return a row.")
    };
  }

  async findDuplicateReportForUser(
    input: DuplicateReportInput
  ): Promise<IncidentReport | null> {
    const [row] = await this.db
      .select()
      .from(incidentReports)
      .where(
        and(
          eq(incidentReports.sessionId, input.sessionId),
          eq(incidentReports.submittedByUserId, input.submittedByUserId),
          eq(incidentReports.raceNumber, input.raceNumber),
          eq(incidentReports.lapNumber, input.lapNumber),
          eq(incidentReports.turnNumber, input.turnNumber),
          eq(incidentReports.carNumber, input.carNumber)
        )
      )
      .limit(1);

    return (row as IncidentReport | undefined) ?? null;
  }

  async getOrderedReportsForSession(sessionId: string): Promise<IncidentReport[]> {
    const rows = await this.db
      .select()
      .from(incidentReports)
      .where(eq(incidentReports.sessionId, sessionId))
      .orderBy(
        incidentReports.raceNumber,
        incidentReports.lapNumber,
        incidentReports.turnNumber,
        incidentReports.createdAt
      );

    return rows as IncidentReport[];
  }

  async getLatestClosedSessionForGuild(
    guildId: string
  ): Promise<IncidentSession | null> {
    const [row] = await this.db
      .select()
      .from(incidentSessions)
      .where(
        and(
          eq(incidentSessions.guildId, guildId),
          eq(incidentSessions.status, "closed")
        )
      )
      .orderBy(desc(incidentSessions.endedAt))
      .limit(1);

    return (row as IncidentSession | undefined) ?? null;
  }

  async getReportByDiscordInteractionId(
    discordInteractionId: string
  ): Promise<IncidentReport | null> {
    const [row] = await this.db
      .select()
      .from(incidentReports)
      .where(eq(incidentReports.discordInteractionId, discordInteractionId))
      .limit(1);

    return (row as IncidentReport | undefined) ?? null;
  }
}

export function createD1IncidentRepository(
  database: D1Database
): DrizzleIncidentRepository {
  return new DrizzleIncidentRepository(drizzleD1(database, { schema }));
}

const schema = {
  guildConfigs,
  incidentSessions,
  incidentReports
};

function requireRow<T>(row: unknown, message: string): T {
  if (!row) {
    throw new Error(message);
  }

  return row as T;
}
