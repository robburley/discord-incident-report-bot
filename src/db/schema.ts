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
    status: text("status", { enum: ["active", "closed"] }).notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at")
  },
  (table) => ({
    activeSessionLookup: index("incident_sessions_active_lookup_idx").on(
      table.guildId,
      table.status
    ),
    latestClosedSessionLookup: index(
      "incident_sessions_latest_closed_lookup_idx"
    ).on(table.guildId, table.status, table.endedAt)
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
