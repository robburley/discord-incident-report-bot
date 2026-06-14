import { and, asc, desc, eq, like, ne, or, sql } from "drizzle-orm";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";

import {
  guildConfigs,
  interactionRateLimits,
  incidentReports,
  incidentSessions,
  penalties,
  penaltyPresets,
  processedDiscordInteractions
} from "./schema";
import type {
  ClearPenaltiesForIncidentInput,
  CompleteStewardingSessionInput,
  CreatePenaltyPresetInput,
  CreateReportingSessionInput,
  DeactivatePenaltyPresetInput,
  EndReportingSessionInput,
  DuplicateReportInput,
  GuildConfig,
  IncidentReport,
  IncidentRepository,
  IncidentSession,
  InsertReportInput,
  InsertReportResult,
  InsertProcessedDiscordInteractionInput,
  InsertProcessedDiscordInteractionResult,
  IncrementInteractionRateLimitInput,
  IncrementInteractionRateLimitResult,
  PenaltyDecisionSummaryRow,
  PenaltyPreset,
  ReopenDecidedSessionForStewardingInput,
  ReopenDecidedSessionForStewardingResult,
  ReopenStewardingSessionForReportingInput,
  ReopenStewardingSessionForReportingResult,
  StartStewardingSessionInput,
  UpsertPenaltyInput,
  UpsertPenaltyResult,
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

  async getReportingSessionForGuild(
    guildId: string
  ): Promise<IncidentSession | null> {
    const [row] = await this.db
      .select()
      .from(incidentSessions)
      .where(
        and(
          eq(incidentSessions.guildId, guildId),
          eq(incidentSessions.status, "reporting")
        )
      )
      .limit(1);

    return (row as IncidentSession | undefined) ?? null;
  }

  async createReportingSession(
    input: CreateReportingSessionInput
  ): Promise<IncidentSession> {
    const latestSession = await this.getLatestSessionForGuild(input.guildId);

    if (latestSession && latestSession.status !== "decided") {
      throw new RepositoryConflictError(
        `Guild ${input.guildId} has an incident session that is not decided.`
      );
    }

    try {
      const [row] = await this.db
        .insert(incidentSessions)
        .values({
          id: this.createId(),
          guildId: input.guildId,
          channelId: input.channelId,
          startedByUserId: input.startedByUserId,
          endedByUserId: null,
          status: "reporting",
          startedAt: this.now(),
          endedAt: null,
          stewardingStartedByUserId: null,
          stewardingCompletedByUserId: null,
          lastReopenedByUserId: null,
          stewardingStartedAt: null,
          stewardingCompletedAt: null,
          lastReopenedAt: null
        })
        .returning();

      return requireRow(row, "Session insert did not return a row.");
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new RepositoryConflictError(
          `Guild ${input.guildId} has an incident session that is not decided.`
        );
      }

      throw error;
    }
  }

  async endReportingSession(
    input: EndReportingSessionInput
  ): Promise<IncidentSession | null> {
    const [row] = await this.db
      .update(incidentSessions)
      .set({
        endedByUserId: input.endedByUserId,
        status: "awaiting_stewards",
        endedAt: this.now()
      })
      .where(
        and(
          eq(incidentSessions.id, input.sessionId),
          eq(incidentSessions.status, "reporting")
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
        note: input.note ?? null,
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

  async getLatestSessionAwaitingStewardsForGuild(
    guildId: string
  ): Promise<IncidentSession | null> {
    const [row] = await this.db
      .select()
      .from(incidentSessions)
      .where(
        and(
          eq(incidentSessions.guildId, guildId),
          eq(incidentSessions.status, "awaiting_stewards")
        )
      )
      .orderBy(desc(incidentSessions.endedAt))
      .limit(1);

    return (row as IncidentSession | undefined) ?? null;
  }

  async getStewardingSessionForGuild(
    guildId: string
  ): Promise<IncidentSession | null> {
    const [row] = await this.db
      .select()
      .from(incidentSessions)
      .where(
        and(
          eq(incidentSessions.guildId, guildId),
          eq(incidentSessions.status, "stewarding")
        )
      )
      .limit(1);

    return (row as IncidentSession | undefined) ?? null;
  }

  async getStewardingSessionForChannel(
    guildId: string,
    channelId: string
  ): Promise<IncidentSession | null> {
    const [row] = await this.db
      .select()
      .from(incidentSessions)
      .where(
        and(
          eq(incidentSessions.guildId, guildId),
          eq(incidentSessions.channelId, channelId),
          eq(incidentSessions.status, "stewarding")
        )
      )
      .limit(1);

    return (row as IncidentSession | undefined) ?? null;
  }

  async startStewardingSession(
    input: StartStewardingSessionInput
  ): Promise<IncidentSession | null> {
    const [row] = await this.db
      .update(incidentSessions)
      .set({
        status: "stewarding",
        stewardingStartedByUserId: input.startedByUserId,
        stewardingStartedAt: this.now()
      })
      .where(
        and(
          eq(incidentSessions.id, input.sessionId),
          eq(incidentSessions.status, "awaiting_stewards")
        )
      )
      .returning();

    return (row as IncidentSession | undefined) ?? null;
  }

  async completeStewardingSession(
    input: CompleteStewardingSessionInput
  ): Promise<IncidentSession | null> {
    const [row] = await this.db
      .update(incidentSessions)
      .set({
        status: "decided",
        stewardingCompletedByUserId: input.completedByUserId,
        stewardingCompletedAt: this.now()
      })
      .where(
        and(
          eq(incidentSessions.id, input.sessionId),
          eq(incidentSessions.status, "stewarding")
        )
      )
      .returning();

    return (row as IncidentSession | undefined) ?? null;
  }

  async reopenStewardingSessionForReporting(
    input: ReopenStewardingSessionForReportingInput
  ): Promise<ReopenStewardingSessionForReportingResult> {
    const latestSession = await this.getLatestSessionForGuild(input.guildId);

    if (!latestSession || latestSession.status !== "stewarding") {
      return {
        status: "no_stewarding_session",
        session: latestSession ?? undefined
      };
    }

    const [existingPenalty] = await this.db
      .select({ id: penalties.id })
      .from(penalties)
      .where(eq(penalties.incidentSessionId, latestSession.id))
      .limit(1);

    if (existingPenalty) {
      return {
        status: "penalties_exist",
        session: latestSession
      };
    }

    const [row] = await this.db
      .update(incidentSessions)
      .set({
        endedByUserId: null,
        endedAt: null,
        status: "reporting",
        stewardingStartedByUserId: null,
        stewardingStartedAt: null,
        lastReopenedByUserId: input.reopenedByUserId,
        lastReopenedAt: this.now()
      })
      .where(
        and(
          eq(incidentSessions.id, latestSession.id),
          eq(incidentSessions.status, "stewarding")
        )
      )
      .returning();

    const session = row as IncidentSession | undefined;

    if (!session) {
      return { status: "no_stewarding_session" };
    }

    return { status: "reopened", session };
  }

  async reopenDecidedSessionForStewarding(
    input: ReopenDecidedSessionForStewardingInput
  ): Promise<ReopenDecidedSessionForStewardingResult> {
    const stewardingSession = await this.getStewardingSessionForGuild(
      input.guildId
    );

    if (stewardingSession) {
      return {
        status: "already_stewarding",
        session: stewardingSession
      };
    }

    const latestSession = await this.getLatestSessionForGuild(input.guildId);

    if (!latestSession || latestSession.status !== "decided") {
      return {
        status: "no_decided_session",
        session: latestSession ?? undefined
      };
    }

    const [row] = await this.db
      .update(incidentSessions)
      .set({
        status: "stewarding",
        stewardingCompletedByUserId: null,
        stewardingCompletedAt: null,
        lastReopenedByUserId: input.reopenedByUserId,
        lastReopenedAt: this.now()
      })
      .where(
        and(
          eq(incidentSessions.id, latestSession.id),
          eq(incidentSessions.status, "decided")
        )
      )
      .returning();

    const session = row as IncidentSession | undefined;

    if (!session) {
      return { status: "no_decided_session" };
    }

    return { status: "reopened", session };
  }

  async getLatestIncidentSummarySessionForGuild(
    guildId: string
  ): Promise<IncidentSession | null> {
    const [row] = await this.db
      .select()
      .from(incidentSessions)
      .where(
        and(
          eq(incidentSessions.guildId, guildId),
          ne(incidentSessions.status, "reporting")
        )
      )
      .orderBy(desc(incidentSessions.startedAt))
      .limit(1);

    return (row as IncidentSession | undefined) ?? null;
  }

  async getLatestDecidedSessionForGuild(
    guildId: string
  ): Promise<IncidentSession | null> {
    const [row] = await this.db
      .select()
      .from(incidentSessions)
      .where(
        and(
          eq(incidentSessions.guildId, guildId),
          eq(incidentSessions.status, "decided")
        )
      )
      .orderBy(desc(incidentSessions.stewardingCompletedAt))
      .limit(1);

    return (row as IncidentSession | undefined) ?? null;
  }

  async createPenaltyPreset(
    input: CreatePenaltyPresetInput
  ): Promise<PenaltyPreset> {
    const now = this.now();
    try {
      const [row] = await this.db
        .insert(penaltyPresets)
        .values({
          id: this.createId(),
          guildId: input.guildId,
          name: input.name,
          outcome: input.outcome,
          delta: input.delta,
          isActive: true,
          createdByUserId: input.createdByUserId,
          deactivatedByUserId: null,
          createdAt: now,
          updatedAt: now,
          deactivatedAt: null
        })
        .returning();

      return requireRow(row, "Penalty preset insert did not return a row.");
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new RepositoryConflictError(
          `Guild ${input.guildId} already has an active penalty preset named ${input.name}.`
        );
      }

      throw error;
    }
  }

  async listPenaltyPresetsForGuild(guildId: string): Promise<PenaltyPreset[]> {
    const rows = await this.db
      .select()
      .from(penaltyPresets)
      .where(
        and(eq(penaltyPresets.guildId, guildId), eq(penaltyPresets.isActive, true))
      )
      .orderBy(asc(penaltyPresets.name), asc(penaltyPresets.createdAt));

    return rows as PenaltyPreset[];
  }

  async searchPenaltyPresetsForGuild(
    guildId: string,
    query: string
  ): Promise<PenaltyPreset[]> {
    const trimmedQuery = query.trim();
    const filters = [
      eq(penaltyPresets.guildId, guildId),
      eq(penaltyPresets.isActive, true)
    ];

    if (trimmedQuery) {
      filters.push(like(penaltyPresets.name, `%${trimmedQuery}%`));
    }

    const rows = await this.db
      .select()
      .from(penaltyPresets)
      .where(and(...filters))
      .orderBy(asc(penaltyPresets.name), asc(penaltyPresets.createdAt))
      .limit(25);

    return rows as PenaltyPreset[];
  }

  async getActivePenaltyPresetForGuild(
    guildId: string,
    presetIdOrName: string
  ): Promise<PenaltyPreset | null> {
    const [row] = await this.db
      .select()
      .from(penaltyPresets)
      .where(
        and(
          eq(penaltyPresets.guildId, guildId),
          eq(penaltyPresets.isActive, true),
          or(
            eq(penaltyPresets.id, presetIdOrName),
            eq(penaltyPresets.name, presetIdOrName)
          )
        )
      )
      .limit(1);

    return (row as PenaltyPreset | undefined) ?? null;
  }

  async deactivatePenaltyPreset(
    input: DeactivatePenaltyPresetInput
  ): Promise<PenaltyPreset | null> {
    const now = this.now();
    const [row] = await this.db
      .update(penaltyPresets)
      .set({
        isActive: false,
        deactivatedByUserId: input.deactivatedByUserId,
        updatedAt: now,
        deactivatedAt: now
      })
      .where(
        and(
          eq(penaltyPresets.id, input.presetId),
          eq(penaltyPresets.isActive, true)
        )
      )
      .returning();

    return (row as PenaltyPreset | undefined) ?? null;
  }

  async upsertPenaltyForIncidentSession(
    input: UpsertPenaltyInput
  ): Promise<UpsertPenaltyResult> {
    const [existing] = await this.db
      .select()
      .from(penalties)
      .where(
        and(
          eq(penalties.incidentSessionId, input.incidentSessionId),
          eq(penalties.incidentReportId, input.incidentReportId),
          eq(penalties.affectedUserId, input.affectedUserId)
        )
      )
      .limit(1);

    const now = this.now();

    const [row] = await this.db
      .insert(penalties)
      .values({
        id: this.createId(),
        incidentSessionId: input.incidentSessionId,
        incidentReportId: input.incidentReportId,
        affectedUserId: input.affectedUserId,
        penaltyPresetId: input.penaltyPresetId,
        outcome: input.outcome,
        delta: input.delta,
        note: input.note,
        createdByUserId: input.createdByUserId,
        updatedByUserId: input.updatedByUserId,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [
          penalties.incidentSessionId,
          penalties.incidentReportId,
          penalties.affectedUserId
        ],
        set: {
          penaltyPresetId: sql`excluded.penalty_preset_id`,
          outcome: sql`excluded.outcome`,
          delta: sql`excluded.delta`,
          note: sql`excluded.note`,
          updatedByUserId: sql`excluded.updated_by_user_id`,
          updatedAt: sql`excluded.updated_at`
        }
      })
      .returning();

    return {
      status: existing ? "updated" : "inserted",
      penalty: requireRow(row, "Penalty upsert did not return a row.")
    };
  }

  async clearPenaltiesForIncidentInSession(
    input: ClearPenaltiesForIncidentInput
  ): Promise<number> {
    const existingRows = await this.db
      .select({ id: penalties.id })
      .from(penalties)
      .where(
        and(
          eq(penalties.incidentSessionId, input.incidentSessionId),
          eq(penalties.incidentReportId, input.incidentReportId)
        )
      );

    await this.db
      .delete(penalties)
      .where(
        and(
          eq(penalties.incidentSessionId, input.incidentSessionId),
          eq(penalties.incidentReportId, input.incidentReportId)
        )
      );

    return existingRows.length;
  }

  async getPenaltiesWithReportsForSession(
    sessionId: string
  ): Promise<PenaltyDecisionSummaryRow[]> {
    const rows = await this.db
      .select({
        penalty: penalties,
        report: incidentReports,
        preset: penaltyPresets
      })
      .from(penalties)
      .innerJoin(
        incidentReports,
        eq(penalties.incidentReportId, incidentReports.id)
      )
      .leftJoin(penaltyPresets, eq(penalties.penaltyPresetId, penaltyPresets.id))
      .where(eq(penalties.incidentSessionId, sessionId))
      .orderBy(
        incidentReports.raceNumber,
        incidentReports.lapNumber,
        incidentReports.turnNumber,
        incidentReports.createdAt,
        penalties.createdAt
      );

    return rows as PenaltyDecisionSummaryRow[];
  }

  async getReportForStewardingSessionByDiscordInteractionId(
    incidentSessionId: string,
    guildId: string,
    discordInteractionId: string
  ): Promise<IncidentReport | null> {
    const [row] = await this.db
      .select({ report: incidentReports })
      .from(incidentReports)
      .innerJoin(incidentSessions, eq(incidentReports.sessionId, incidentSessions.id))
      .where(
        and(
          eq(incidentSessions.id, incidentSessionId),
          eq(incidentSessions.guildId, guildId),
          eq(incidentSessions.status, "stewarding"),
          eq(incidentReports.guildId, guildId),
          eq(incidentReports.discordInteractionId, discordInteractionId)
        )
      )
      .limit(1);

    return row?.report ?? null;
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

  async insertProcessedDiscordInteraction(
    input: InsertProcessedDiscordInteractionInput
  ): Promise<InsertProcessedDiscordInteractionResult> {
    try {
      await this.db
        .insert(processedDiscordInteractions)
        .values({
          interactionId: input.interactionId,
          guildId: input.guildId,
          commandName: input.commandName,
          subcommandName: input.subcommandName,
          createdAt: this.now()
        });

      return { status: "inserted" };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { status: "duplicate" };
      }

      throw error;
    }
  }

  async incrementInteractionRateLimit(
    input: IncrementInteractionRateLimitInput
  ): Promise<IncrementInteractionRateLimitResult> {
    const now = this.now();
    const windowMilliseconds = input.windowSeconds * 1_000;
    const windowStart = Math.floor(now / windowMilliseconds) * windowMilliseconds;

    const [row] = await this.db
      .insert(interactionRateLimits)
      .values({
        rateLimitKey: input.key,
        guildId: input.guildId,
        userId: input.userId,
        action: input.action,
        windowStart,
        requestCount: 1,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: interactionRateLimits.rateLimitKey,
        set: {
          guildId: input.guildId,
          userId: input.userId,
          action: input.action,
          windowStart,
          requestCount: sql`case when ${interactionRateLimits.windowStart} = ${windowStart} then ${interactionRateLimits.requestCount} + 1 else 1 end`,
          updatedAt: now
        }
      })
      .returning({
        requestCount: interactionRateLimits.requestCount,
        windowStart: interactionRateLimits.windowStart
      });

    const requestCount = Number(row?.requestCount ?? 1);
    const storedWindowStart = Number(row?.windowStart ?? windowStart);

    if (requestCount <= input.limit) {
      return { status: "allowed", count: requestCount };
    }

    return {
      status: "limited",
      count: requestCount,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((storedWindowStart + windowMilliseconds - now) / 1_000)
      )
    };
  }

  private async getLatestSessionForGuild(
    guildId: string
  ): Promise<IncidentSession | null> {
    const [row] = await this.db
      .select()
      .from(incidentSessions)
      .where(eq(incidentSessions.guildId, guildId))
      .orderBy(desc(incidentSessions.startedAt))
      .limit(1);

    return (row as IncidentSession | undefined) ?? null;
  }
}

export function createD1IncidentRepository(
  database: D1Database
): DrizzleIncidentRepository {
  return new DrizzleIncidentRepository(drizzleD1(database, { schema }));
}

const schema = {
  guildConfigs,
  interactionRateLimits,
  incidentSessions,
  incidentReports,
  penaltyPresets,
  penalties,
  processedDiscordInteractions
};

function requireRow<T>(row: unknown, message: string): T {
  if (!row) {
    throw new Error(message);
  }

  return row as T;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /unique constraint|unique failed|constraint failed/i.test(error.message);
}
