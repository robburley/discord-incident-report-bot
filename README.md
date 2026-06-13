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
local binding is named `INCIDENT_DB` in `wrangler.toml`.

Apply migrations to the production D1 database after `wrangler.toml` contains
the real production database ID:

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
- `DISCORD_TEST_GUILD_ID`: guild/server ID where development commands should be registered.

The Worker expects a D1 binding named `INCIDENT_DB` when using persistent incident storage.

Command registration requires:

- `DISCORD_APPLICATION_ID`: application ID from the Discord developer portal.
- `DISCORD_BOT_TOKEN`: bot token from the Discord developer portal.
- `DISCORD_TEST_GUILD_ID`: guild/server ID where development commands should be registered.

Register slash commands to the configured test guild:

```sh
npm run register:commands
```

The registration script uses Discord's guild command endpoint so commands appear quickly during development. It overwrites this bot's command set in the configured test guild and does not register global commands.

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
npm run register:commands
```

The registration script reads `.dev.vars` and lets shell environment variables
override those values. If command definitions change, run the registration
command again.

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

## Cloudflare Deployment Notes

Production deploys use the same Worker entrypoint and `INCIDENT_DB` binding.
The committed `wrangler.toml` includes the binding shape with a placeholder
database ID. Create the production D1 database, then replace the placeholder
`database_id` with the ID printed by Wrangler:

```sh
wrangler d1 create incident-bot
```

In non-interactive shells, Wrangler requires `CLOUDFLARE_API_TOKEN` to be set
before D1, secret, migration, or deploy commands can run.

Store Discord credentials as Worker secrets before deploying:

```sh
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_BOT_TOKEN
```

Apply D1 migrations to production, then deploy:

```sh
npm run db:migrate:prod
npm run deploy
```

After deploy, set the Discord application's Interactions Endpoint URL to the
deployed Worker URL. Discord should validate the endpoint by sending a signed
`PING` interaction. Register commands for the test guild with:

```sh
npm run register:commands
```

Run a live smoke test in the test guild:

1. Configure a manager role with `/incident-config role`.
2. Start a session with `/incident-session start`.
3. Submit at least one incident with `/incident`.
4. End the session with `/incident-session end` and confirm the summary posts.
5. Run `/incident-session summary` and confirm the latest closed session summary
   is reposted to the original session channel.

If summary posting fails but the session closes, use `/incident-session summary`
to recover the latest closed summary after fixing Discord permissions or token
configuration.
