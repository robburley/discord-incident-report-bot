# Incident Bot

A serverless Discord incident-reporting bot for race sessions, built with Cloudflare Workers, TypeScript, Vitest, Wrangler, and Drizzle.

## Local Setup

Install dependencies:

```sh
npm install
```

Copy the local environment template and fill in values from the Discord
Developer Portal:

```sh
cp .dev.vars.example .dev.vars
```

Run checks:

```sh
npm run typecheck
npm run test
```

Run tests in watch mode while developing:

```sh
npm run test:watch
```

Generate and apply local D1 migrations:

```sh
npm run db:generate
npm run db:migrate
```

Start the Worker locally:

```sh
npm run dev
```

`npm run db:migrate` applies migrations to Wrangler's local D1 database. The
local binding is named `INCIDENT_DB` in `wrangler.toml`. Local migrations are
safe to rerun; Wrangler records which migration files have already been applied.

Apply migrations to the production D1 database after `wrangler.prod.toml`
contains the real production database ID:

```sh
npm run db:migrate:prod
```

The Worker entrypoint is `src/platform/cloudflare.ts`. Keep platform-neutral logic in `src/core`, Discord-specific code in `src/discord`, database code in `src/db`, and Cloudflare-specific adapter code in `src/platform`.

## Environment

Local secrets should go in `.dev.vars`, which must not be committed.

The Worker currently requires:

- `DISCORD_PUBLIC_KEY`: public key from the Discord application, used by the Worker to verify interaction signatures.
- `DISCORD_BOT_TOKEN`: bot token from the Discord developer portal, used server-side to post session messages and summaries.
- `DISCORD_APPLICATION_ID`: application ID from the Discord developer portal.
- `DISCORD_TEST_GUILD_ID`: development-only guild/server ID where guild commands should be registered for fast local iteration. Production global command registration does not use this value.

The Worker expects a D1 binding named `INCIDENT_DB` when using persistent incident storage.

Command registration requires:

- `DISCORD_APPLICATION_ID`: application ID from the Discord developer portal.
- `DISCORD_BOT_TOKEN`: bot token from the Discord developer portal.
- `DISCORD_TEST_GUILD_ID`: development-only guild/server ID where commands should be registered. This is only required for guild registration.

Register slash commands to the configured test guild:

```sh
npm run register:commands:guild
```

Register production slash commands globally:

```sh
npm run register:commands:global
```

Guild registration uses Discord's guild command endpoint so commands appear
quickly during development. It overwrites this bot's command set in the
configured test guild. Global registration uses Discord's application command
endpoint, does not require `DISCORD_TEST_GUILD_ID`, and can take time to appear
in Discord clients. `npm run register:commands` prints guidance instead of
registering commands so the target scope stays explicit.

## Discord App Setup

Create an application in the Discord Developer Portal, then open the `Bot`
section and create a bot user. Copy the bot token into `.dev.vars` as
`DISCORD_BOT_TOKEN`; do not commit the real token.

In the `General Information` section, copy the application ID into
`DISCORD_APPLICATION_ID` and the public key into `DISCORD_PUBLIC_KEY`.

Invite the bot to the test guild with the `applications.commands` scope and the
bot permissions needed to send messages in the incident channel. Enable
Developer Mode in Discord, right-click the test server, copy its ID, and set
`DISCORD_TEST_GUILD_ID`.

After the environment values are set, register guild commands:

```sh
npm run register:commands:guild
```

The registration script reads `.dev.vars` and lets shell environment variables
override those values. If command definitions change, run the registration
command again. Use `npm run register:commands:global` when command definition
changes should be published globally for production.

## Discord Production Install

Register global commands before installing the bot into general-purpose test or
production servers:

```sh
npm run register:commands:global
```

Global commands can take time to propagate in Discord clients. Guild command
registration is still the faster local-development path, but servers outside
`DISCORD_TEST_GUILD_ID` need globally registered commands.

Use this OAuth2 install URL format for server installation:

```text
https://discord.com/oauth2/authorize?client_id=<DISCORD_APPLICATION_ID>&scope=bot%20applications.commands&permissions=3072
```

Replace `<DISCORD_APPLICATION_ID>` with the application ID from the Discord
Developer Portal. The required OAuth scopes are:

- `bot`: installs the bot user so the Worker can post session messages,
  incident report notices, and summaries through Discord REST.
- `applications.commands`: installs the slash commands for the server.

The minimum bot permission integer above is `3072`, which grants:

- `View Channels`
- `Send Messages`

The bot does not need administrator permissions. Server channel overrides can
still block posting, so confirm the bot can view and send messages in the
channels where sessions will be started. The user installing the bot must have
permission in Discord to add apps or manage the target server.

After install, each server must be configured by an admin:

```text
/incident-config role role:<manager role>
```

That role controls who can start and end incident sessions. Until this setup is
complete, incident commands are intentionally blocked for that server.

Admins can verify server setup with:

```text
/incident-config status
```

The status command can be used by members with Discord's `Manage Server`
permission or the configured incident manager role. It reports the configured
manager role, or tells the admin to run
`/incident-config role role:<manager role>` when setup has not been completed.

Stewards can request the user guide with:

```text
/incident-config help
```

The help command can be used by members with Discord's `Manage Server`
permission or the configured incident manager role. The guide is sent by DM,
with an ephemeral server confirmation or a clear ephemeral error if DMs are
blocked.

`/incident-config` may appear to users who cannot use every protected
subcommand because this release relies on bot-side authorization instead of
automated Discord command-permission management. Server admins can optionally
hide or restrict `/incident-config` through Discord Server Settings or
Integrations command permissions.

## Incident Workflow

Incident sessions move through this status flow:

```text
reporting -> awaiting_stewards -> stewarding -> decided
```

Managers can reverse only the latest session in two controlled cases:

```text
awaiting_stewards -> reporting
decided -> stewarding
```

Use `/incident-session start` in the incident channel to open reporting. Drivers
can use `/incident` only while the latest session is in `reporting`, and reports
must be submitted in that session's channel. A new reporting session cannot
start until the previous latest session is `decided`.

Use `/incident-session end` to close reporting. This moves the session to
`awaiting_stewards` and posts the incident report summary in the original
session channel. Managers can use `/incident-session summary` to repost that
incident list later. This summary is the report list, not the stewarding
decision summary.

If reporting was ended too early, use `/incident-session reopen-reporting`.
This only works when the latest session is still `awaiting_stewards`; once
stewarding has started, reporting cannot be reopened.

Use `/incident-session steward` to move the latest `awaiting_stewards` session
to `stewarding`. Stewarding decisions are then recorded in the same original
session channel.

Use `/incident-session complete` to move the stewarding session to `decided`
and post the final decision summary. Managers can use
`/incident-session decisions` to repost the latest decided session's stewarding
summary if the final messages need to be repeated or recovered after a posting
failure.

If decisions need correction after completion, use
`/incident-session reopen-stewarding`. This only works on the latest `decided`
session and preserves existing penalties so managers can update them. Complete
the session again after corrections.

## Penalty Presets And Decisions

Admins configure penalty presets per server:

```text
/incident-config penalty-add name:<preset name> outcome:<summary text> delta:<optional integer>
/incident-config penalty-remove penalty:<preset>
/incident-config penalties
```

The optional `delta` can represent whatever total a league uses, such as points,
seconds, strikes, or another numeric value. Removing a preset deactivates it
instead of deleting it, so old stewarding summaries still show the original
decision text. Penalty names, outcomes, and notes are stored as short
single-line Discord-safe strings; line breaks are collapsed and backticks are
normalized before display.

Managers assign penalties during `stewarding`:

```text
/incident-session penalty incident-id:<id> affected-user:<driver> penalty:<preset> note:<optional note>
/incident-session penalty-clear incident-id:<id>
```

Use the public incident ID shown in the incident summary. The `penalty` option
uses autocomplete and returns up to Discord's limit of 25 active presets for the
server. Autocomplete is a helper, not the source of truth: the bot validates
that the submitted preset still exists and is active when the command runs.

Assigning a penalty to the same incident and affected user again updates the
existing decision. Assigning penalties to different affected users on the same
incident creates separate decisions. Optional notes are stored with the
decision and shown in the per-decision messages.

`/incident-session penalty-clear` hard-deletes all penalty decisions for the
given incident in the current stewarding session. It does not affect decisions
for other incidents.

## Command Responses

Errors and manager confirmations are ephemeral. Workflow messages that change
the visible session state are posted publicly in the original session channel.

These commands post public channel messages:

- `/incident-session start`: reporting started.
- `/incident-session end`: one or more incident report summary messages.
- `/incident-session steward`: stewarding started.
- `/incident-session penalty`: recorded or updated penalty decision, including
  affected driver mention and outcome.
- `/incident-session penalty-clear`: cleared decision notice when decisions were
  actually removed.
- `/incident-session complete`: one or more stewarding decision summary
  messages.
- `/incident-session decisions`: one or more reposted stewarding decision
  summary messages.
- `/incident-session reopen-reporting`: reporting reopened.
- `/incident-session reopen-stewarding`: stewarding reopened.

These commands reply ephemerally only:

- `/incident-config role`
- `/incident-config status`
- `/incident-config help`
- `/incident-config penalty-add`
- `/incident-config penalty-remove`
- `/incident-config penalties`

`/incident-config help` also sends the steward guide by DM when delivery
succeeds. Live DM behavior must be smoke tested because user privacy settings,
bot install state, or the bot/user relationship can block DM delivery.

`/incident-session end`, `/incident-session complete`,
`/incident-session summary`, and `/incident-session decisions` defer the
ephemeral response while posting summary messages. If posting fails, fix the
bot's channel permissions or token configuration, then rerun
`/incident-session summary` for report lists or `/incident-session decisions`
for stewarding decisions.

Second test server checklist:

1. Confirm the deployed Worker URL is set as the Discord application's
   Interactions Endpoint URL.
2. Run `npm run register:commands:global` for the production Discord
   application.
3. Open the OAuth2 install URL with the production `DISCORD_APPLICATION_ID`.
4. Choose the second Discord test server and approve the `bot` and
   `applications.commands` scopes.
5. Confirm the bot has `View Channels` and `Send Messages` in the intended
   incident channel.
6. Run `/incident-config role role:<manager role>` in the second server.
7. Run `/incident-config status` and confirm it reports the manager role.
8. Run `/incident-config help` and confirm the guide is delivered by DM.
9. Start, steward, complete, and repost a short incident session to confirm
   command handling and channel posting.

If commands do not appear:

- Confirm global commands were registered against the same application ID used
  in the install URL.
- Wait for Discord global command propagation, then restart or refresh the
  Discord client.
- Confirm the server install included the `applications.commands` scope.
- Confirm the Discord application's Interactions Endpoint URL points to the
  deployed Worker URL, not an old local tunnel.
- Re-run `npm run register:commands:global` after command definition changes.
- For local iteration, use `npm run register:commands:guild` and test in
  `DISCORD_TEST_GUILD_ID` instead of waiting for global propagation.

## Local Discord Endpoint

Discord must be able to reach the Worker over HTTPS. Start the local Worker:

```sh
npm run dev
```

Expose the local Worker with Cloudflare Tunnel or a similar HTTPS tunnel:

```sh
cloudflared tunnel --url http://localhost:8787
```

Copy the generated HTTPS tunnel URL and set the Discord application's
Interactions Endpoint URL to that URL. If Wrangler is running on another port,
use that port in the tunnel command. Tunnel URLs can change between runs, so
update the Discord endpoint whenever the URL changes.

Discord validates the endpoint by sending a signed `PING` interaction. If
validation fails, confirm that `.dev.vars` contains the correct
`DISCORD_PUBLIC_KEY`, `npm run dev` is still running, and the tunnel points to
the active Wrangler port.

## Production Deployment

Production deploys use the same Worker entrypoint and `INCIDENT_DB` binding.
The committed `wrangler.toml` includes the binding shape with a placeholder
database ID. Keep the real production database ID in `wrangler.prod.toml`,
which is ignored by Git:

```sh
cp wrangler.toml wrangler.prod.toml
```

Create the production D1 database, then set `database_id` in
`wrangler.prod.toml` to the ID printed by Wrangler:

```sh
wrangler d1 create incident-bot
```

In non-interactive shells, Wrangler requires `CLOUDFLARE_API_TOKEN` to be set
before D1, secret, migration, or deploy commands can run.

Store Discord credentials as Worker secrets before deploying. Production should
use Worker secrets for `DISCORD_PUBLIC_KEY` and `DISCORD_BOT_TOKEN`; use normal
Wrangler vars or configuration for non-secret values such as
`DISCORD_APPLICATION_ID`.

```sh
npm run secrets:set:discord-public-key
npm run secrets:set:discord-bot-token
```

Production deployment order:

1. Create or confirm the production D1 database and `INCIDENT_DB` binding in
   `wrangler.prod.toml`.
2. Set or rotate Worker secrets with
   `npm run secrets:set:discord-public-key` and
   `npm run secrets:set:discord-bot-token`.
3. Apply D1 migrations to the production database.
4. Deploy the Worker.
5. Set the Discord application's Interactions Endpoint URL to the deployed
   Worker URL.
6. Register global commands.
7. Install the bot into target Discord servers with the OAuth2 install URL.
8. Configure each server with `/incident-config role role:<manager role>`.
9. Verify each server with `/incident-config status` and a smoke test.

Apply D1 migrations to production, then deploy:

```sh
npm run db:migrate:prod
npm run deploy
```

Production D1 migrations are shared by every installed server because all guilds
use the same D1 database with tenant data keyed by Discord guild ID. Apply
migrations before installing the bot into new servers or publishing command
changes that depend on new database shape.

For local verification, run `npm run db:migrate` against Wrangler's local D1
database before starting `npm run dev`. For deployed databases, confirm
`wrangler.prod.toml` points at the intended D1 database, set
`CLOUDFLARE_API_TOKEN` in non-interactive environments, and run
`npm run db:migrate:prod` before deploying command or Worker changes that
depend on the new schema.

After deploy, set the Discord application's Interactions Endpoint URL to the
deployed Worker URL. Discord should validate the endpoint by sending a signed
`PING` interaction. For local development, register commands for the test guild
with:

```sh
npm run register:commands:guild
```

Register production global commands with the production
`DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN`:

```sh
npm run register:commands:global
```

Re-register global commands after any command definition change in
`src/discord/commands.ts`. Discord global command propagation can take time, so
wait for clients to refresh before treating missing commands as a deployment
failure.

The steward guide source lives in `docs/steward-user-guide.md`. Update that
file when steward-facing process documentation changes, run tests and
typecheck, then redeploy so the bundled Worker content is refreshed. Guide
content changes alone do not require Discord command registration, but any
slash command definition change in `src/discord/commands.ts` does.

To rotate `DISCORD_BOT_TOKEN`:

1. Reset or regenerate the bot token in the Discord Developer Portal.
2. Immediately update the Worker secret with
   `npm run secrets:set:discord-bot-token`.
3. Redeploy if your Cloudflare setup does not make secret updates available to
   the active Worker version automatically.
4. Re-run a short smoke test that starts and ends a session, because posting
   session messages and summaries depends on the bot token.
5. Update any local `.dev.vars` or CI secret stores that are intentionally used
   for command registration.

Do not paste the token into issue comments, chat, logs, or committed files.

Inspect Worker logs during production smoke tests with:

```sh
wrangler --config wrangler.prod.toml tail
```

The Cloudflare dashboard can also show Worker logs when observability logging is
enabled. Use logs to confirm interaction handling, command scope, guild IDs, and
posting failures without exposing Discord secrets.

Production release checklist:

1. `npm install` succeeds from a clean checkout.
2. `npm run typecheck` passes.
3. `npm test` passes.
4. Production D1 migrations have been applied.
5. Worker secrets are set or rotated for `DISCORD_PUBLIC_KEY` and
   `DISCORD_BOT_TOKEN`.
6. The Worker deploy succeeds.
7. The Discord Interactions Endpoint URL points to the deployed Worker.
8. `npm run register:commands:global` has been run for the production
   application.
9. The OAuth2 install URL uses the production application ID and required
   permissions.
10. Each installed server has run `/incident-config role role:<manager role>`.
11. Each installed server passes `/incident-config status`.
12. `/incident-config help` has been smoke tested with a Manage Server user and
    a configured manager-role steward.
13. DM failure behavior has been smoke tested or explicitly marked blocked by
    Discord privacy or account setup.
14. A two-server live smoke test has completed successfully.

## Private Release Operations

This version is intended for private or shared-link installation only. Do not
list the bot publicly or share the OAuth2 install URL beyond the intended test
or partner servers until the public-release requirements are revisited.

The bot stores only the Discord data needed to operate incident sessions:

- Guild/server IDs.
- Channel IDs for incident sessions.
- User IDs for session starters, session enders, and incident submitters.
- Role IDs for configured incident manager roles.
- Incident session status and timestamps.
- Stewarding audit user IDs and timestamps for session start, completion, and
  reopen actions.
- Incident report details submitted through the modal: race number, lap number,
  turn number, and car number.
- Penalty preset names, outcomes, optional numeric deltas, and soft-delete
  status.
- Penalty decisions, affected user IDs, optional notes, copied preset deltas,
  and penalty audit timestamps.

The bot does not store Discord bot tokens, Discord public keys, usernames,
display names, email addresses, message contents outside the incident report
fields, or uploaded files in D1. Worker logs may include operational context
such as event names, command names, guild IDs, and error details. Do not add
secrets or raw Discord tokens to logs.

Support for this private release is handled by the project operator through the
same private channel used to share the install URL. Server admins should report:

- The affected Discord server.
- The command they ran.
- Approximate time of the failure.
- Whether the bot could view and send messages in the channel.

Server data removal is an operator process in this version. If a server admin
asks for stored data to be deleted, first confirm the target Discord guild ID,
then back up the production D1 database if needed. Delete rows for that guild
from `penalties`, `incident_reports`, `incident_sessions`, `penalty_presets`,
and `guild_configs`, in that order, so decision, report, and session data is
removed before presets and server configuration. Verify `/incident-config
status` reports the server as unconfigured if the bot is still installed.

There is no `/incident-config clear` command in this private release. Add one
only if broader rollout needs server admins to self-service config or data
removal.

Private release checklist:

1. Confirm the bot remains private/shared-link only for this version.
2. Share the install URL only with approved server admins.
3. Confirm each server admin understands `/incident-config role`,
   `/incident-config status`, and `/incident-config help`.
4. Confirm support requests have a private contact path.
5. Confirm any data deletion request is handled by an operator with D1 access.
6. Revisit Discord verification, hosted privacy terms, and self-service deletion
   before any public listing or broad distribution.

Run a live stewarding smoke test in the test guild:

1. Configure a manager role with `/incident-config role`.
2. Verify setup with `/incident-config status`.
3. Request the steward guide with `/incident-config help` and confirm the guide
   arrives by DM.
4. Start a reporting session with `/incident-session start`.
5. Submit at least two reports with `/incident`.
6. Try to start a second session before the first is decided and confirm it is
   rejected.
7. Configure at least two penalty presets with `/incident-config penalty-add`.
8. End reporting with `/incident-session end` and confirm the incident list
   posts.
9. Reopen to reporting with `/incident-session reopen-reporting`, submit
   another report, then end reporting again.
10. Start stewarding with `/incident-session steward`.
11. Add one or more penalties with `/incident-session penalty`, using
    autocomplete for the preset and selecting an affected user.
12. Update one penalty for the same incident and affected user.
13. Add a penalty note.
14. Clear penalties for one incident with `/incident-session penalty-clear`.
15. Remove a used preset with `/incident-config penalty-remove` and confirm it
    disappears from `/incident-config penalties` and autocomplete.
16. Complete stewarding with `/incident-session complete`.
17. Reopen stewarding with `/incident-session reopen-stewarding`.
18. Update a penalty, then complete stewarding again.
19. Confirm the final decision summary contains only incidents with outcomes.
20. Repost decisions with `/incident-session decisions`.

If incident-list posting fails after reporting ends, fix Discord permissions or
token configuration and use `/incident-session summary` to repost the latest
report list. If decision-summary posting fails after stewarding completes, fix
the same posting issue and use `/incident-session decisions` to repost the
latest stewarding decisions.
