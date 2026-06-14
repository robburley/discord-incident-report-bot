import {
  sql
} from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

export const guildConfigs = sqliteTable("guild_configs", {
  guildId: text("guild_id").primaryKey(),
  managerRoleId: text("manager_role_id").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const incidentSessions = sqliteTable(
  "incident_sessions",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    startedByUserId: text("started_by_user_id").notNull(),
    endedByUserId: text("ended_by_user_id"),
    status: text("status", {
      enum: ["reporting", "awaiting_stewards", "stewarding", "decided"]
    }).notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    stewardingStartedByUserId: text("stewarding_started_by_user_id"),
    stewardingCompletedByUserId: text("stewarding_completed_by_user_id"),
    lastReopenedByUserId: text("last_reopened_by_user_id"),
    stewardingStartedAt: integer("stewarding_started_at"),
    stewardingCompletedAt: integer("stewarding_completed_at"),
    lastReopenedAt: integer("last_reopened_at")
  },
  (table) => ({
    reportingSessionLookup: index("incident_sessions_reporting_lookup_idx").on(
      table.guildId,
      table.status
    ),
    stewardingSessionLookup: index(
      "incident_sessions_stewarding_lookup_idx"
    ).on(table.guildId, table.channelId, table.status),
    latestAwaitingStewardsSessionLookup: index(
      "incident_sessions_latest_awaiting_stewards_lookup_idx"
    ).on(table.guildId, table.status, table.endedAt),
    oneOpenSessionPerGuild: uniqueIndex(
      "incident_sessions_one_open_session_per_guild_unique"
    )
      .on(table.guildId)
      .where(sql`${table.status} <> 'decided'`)
  })
);

export const incidentReports = sqliteTable(
  "incident_reports",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    guildId: text("guild_id").notNull(),
    submittedByUserId: text("submitted_by_user_id").notNull(),
    discordInteractionId: text("discord_interaction_id").notNull(),
    raceNumber: integer("race_number").notNull(),
    lapNumber: integer("lap_number").notNull(),
    turnNumber: integer("turn_number").notNull(),
    carNumber: text("car_number").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    discordInteractionIdUnique: uniqueIndex(
      "incident_reports_discord_interaction_id_unique"
    ).on(table.discordInteractionId),
    orderedReportLookup: index("incident_reports_ordered_lookup_idx").on(
      table.sessionId,
      table.raceNumber,
      table.lapNumber,
      table.turnNumber,
      table.createdAt
    ),
    duplicateReportLookup: index("incident_reports_duplicate_lookup_idx").on(
      table.sessionId,
      table.submittedByUserId,
      table.raceNumber,
      table.lapNumber,
      table.turnNumber,
      table.carNumber
    )
  })
);

export const penaltyPresets = sqliteTable(
  "penalty_presets",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    name: text("name").notNull(),
    outcome: text("outcome").notNull(),
    delta: integer("delta"),
    isActive: integer("is_active", { mode: "boolean" }).notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    deactivatedByUserId: text("deactivated_by_user_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deactivatedAt: integer("deactivated_at")
  },
  (table) => ({
    activePresetLookup: index("penalty_presets_active_lookup_idx").on(
      table.guildId,
      table.isActive,
      table.name
    ),
    activePresetNameUnique: uniqueIndex(
      "penalty_presets_active_name_unique"
    )
      .on(table.guildId, table.name)
      .where(sql`${table.isActive} = 1`)
  })
);

export const penalties = sqliteTable(
  "penalties",
  {
    id: text("id").primaryKey(),
    incidentSessionId: text("incident_session_id").notNull(),
    incidentReportId: text("incident_report_id").notNull(),
    affectedUserId: text("affected_user_id").notNull(),
    penaltyPresetId: text("penalty_preset_id").notNull(),
    outcome: text("outcome").notNull(),
    delta: integer("delta"),
    note: text("note"),
    createdByUserId: text("created_by_user_id").notNull(),
    updatedByUserId: text("updated_by_user_id").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => ({
    sessionPenaltyLookup: index("penalties_session_lookup_idx").on(
      table.incidentSessionId
    ),
    incidentPenaltyLookup: index("penalties_incident_lookup_idx").on(
      table.incidentSessionId,
      table.incidentReportId
    ),
    onePenaltyPerAffectedUser: uniqueIndex(
      "penalties_session_report_affected_user_unique"
    ).on(
      table.incidentSessionId,
      table.incidentReportId,
      table.affectedUserId
    )
  })
);
