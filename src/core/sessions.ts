import { RepositoryConflictError } from "../db/repository";
import type {
  IncidentRepository,
  IncidentSession
} from "../db/repository";
import { hasManagerRole } from "./authorization";
import { formatSplitSessionSummary } from "./summary";

interface SessionActionInput {
  readonly repository: IncidentRepository;
  readonly guildId: string;
  readonly userId: string;
  readonly memberRoleIds: readonly string[];
}

export interface StartIncidentSessionInput extends SessionActionInput {
  readonly channelId: string;
}

export type StartIncidentSessionResult =
  | {
      readonly status: "started";
      readonly session: IncidentSession;
    }
  | {
      readonly status: "guild_not_configured" | "unauthorized" | "active_session_exists";
      readonly message: string;
      readonly session?: IncidentSession;
    };

export interface EndIncidentSessionInput extends SessionActionInput {}

export type EndIncidentSessionResult =
  | {
      readonly status: "ended";
      readonly session: IncidentSession;
      readonly summaryMessages: readonly string[];
    }
  | {
      readonly status: "guild_not_configured" | "unauthorized" | "no_active_session";
      readonly message: string;
    };

export interface LatestSessionSummaryInput extends SessionActionInput {}

export type LatestSessionSummaryResult =
  | {
      readonly status: "found";
      readonly session: IncidentSession;
      readonly summaryMessages: readonly string[];
    }
  | {
      readonly status:
        | "guild_not_configured"
        | "unauthorized"
        | "no_closed_session";
      readonly message: string;
    };

export async function startIncidentSession(
  input: StartIncidentSessionInput
): Promise<StartIncidentSessionResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const existing = await input.repository.getActiveSession(input.guildId);

  if (existing) {
    return {
      status: "active_session_exists",
      message: "An incident session is already active for this server.",
      session: existing
    };
  }

  try {
    const session = await input.repository.createSession({
      guildId: input.guildId,
      channelId: input.channelId,
      startedByUserId: input.userId
    });

    return {
      status: "started",
      session
    };
  } catch (error) {
    if (error instanceof RepositoryConflictError) {
      return {
        status: "active_session_exists",
        message: "An incident session is already active for this server."
      };
    }

    throw error;
  }
}

export async function endIncidentSession(
  input: EndIncidentSessionInput
): Promise<EndIncidentSessionResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const activeSession = await input.repository.getActiveSession(input.guildId);

  if (!activeSession) {
    return {
      status: "no_active_session",
      message: "There is no active incident session to end."
    };
  }

  const closedSession = await input.repository.closeSession({
    sessionId: activeSession.id,
    endedByUserId: input.userId
  });

  if (!closedSession) {
    return {
      status: "no_active_session",
      message: "There is no active incident session to end."
    };
  }

  const reports = await input.repository.getOrderedReportsForSession(
    closedSession.id
  );

  return {
    status: "ended",
    session: closedSession,
    summaryMessages: formatSplitSessionSummary({
      session: closedSession,
      reports
    })
  };
}

export async function getLatestClosedSessionSummary(
  input: LatestSessionSummaryInput
): Promise<LatestSessionSummaryResult> {
  const auth = await authorizeSessionAction(input);

  if (auth.status !== "authorized") {
    return auth;
  }

  const session = await input.repository.getLatestClosedSessionForGuild(
    input.guildId
  );

  if (!session) {
    return {
      status: "no_closed_session",
      message: "No closed incident session summary is available yet."
    };
  }

  const reports = await input.repository.getOrderedReportsForSession(session.id);

  return {
    status: "found",
    session,
    summaryMessages: formatSplitSessionSummary({ session, reports })
  };
}

async function authorizeSessionAction(
  input: SessionActionInput
): Promise<
  | {
      readonly status: "authorized";
    }
  | {
      readonly status: "guild_not_configured" | "unauthorized";
      readonly message: string;
    }
> {
  const config = await input.repository.getGuildConfig(input.guildId);

  if (!config) {
    return {
      status: "guild_not_configured",
      message: "Configure an incident manager role before using incidents."
    };
  }

  if (
    !hasManagerRole({
      managerRoleId: config.managerRoleId,
      memberRoleIds: input.memberRoleIds
    })
  ) {
    return {
      status: "unauthorized",
      message: "Only incident managers can use this command."
    };
  }

  return { status: "authorized" };
}
