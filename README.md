# boilout-app

Slack bot for fryer boilout and filter-change schedules. One Node process serves many Slack workplaces: each workplace installs the same Slack app, then gets its own JSON files for channel IDs and fryer state.

Socket Mode carries events. A public HTTPS URL is still required for the OAuth install redirect (`/slack/install` and `/slack/oauth_redirect`). Persist the `data/` directory across restarts.

## New Slack app (once)

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps) → **From a manifest** and paste [`manifest.json`](manifest.json).
2. Replace `YOUR_PUBLIC_HOST` in the manifest redirect URL with your public hostname, then install the manifest.
3. Enable **Socket Mode** and create an **App-Level Token** with `connections:write`. Copy:
   - App ID, Client ID, Client Secret, Signing Secret
   - App-Level Token (`xapp-...`)
4. Under **OAuth & Permissions**, confirm the redirect URL is `https://YOUR_PUBLIC_HOST/slack/oauth_redirect`.
5. Copy [`.env.example`](.env.example) to `.env` and fill those values. Set `SLACK_STATE_SECRET` to a long random string.

```bash
npm install
npm start
```

Visit `https://YOUR_PUBLIC_HOST/slack/install` (or `http://localhost:3000/slack/install` when testing) and click **Add to Slack**.

## New workplace (each store)

1. Install the app into the workplace (Add to Slack). The success page prints the workspace `team_id` (for example `T0123ABCD`). You can also run `/boilout-setup` in Slack.
2. Copy the settings template:

   ```bash
   mkdir -p data/T0123ABCD
   cp data/settings.example.json data/T0123ABCD/settings.json
   ```

3. Edit `data/T0123ABCD/settings.json`:

   | Field | Purpose |
   | --- | --- |
   | `channels.boilout` | Image submit flow and Monday 9am weekly schedule |
   | `channels.boh_general` | Daily 6pm filter reminders |
   | `channels.filter_reminder` | `/filter-reminder` target (optional; defaults to `boh_general`) |
   | `channels.notify_user` | User or DM to notify when a boilout is submitted |
   | `admin_user_ids` | Users allowed to run `/quiz` and `/filter-reminder` |
   | `timezone` | Calendar dates for “today” (cron still fires on America/New_York) |

4. Invite the bot to every channel listed in that file.
5. Open the App Home tab and add fryers. Fryer state is stored in `data/T0123ABCD/config.json`.

Workspace files:

```
data/
  settings.example.json
  installations/T0123ABCD/app-latest          # OAuth tokens (created on install)
  T0123ABCD/
    settings.json                           # channels and admins
    config.json                             # fryers
    quiz-responses.json
    question-stats.json
```

Slash commands: `/week`, `/month`, `/quiz`, `/filter-reminder`, `/boilout-setup`.

## Migrating the original workplace

If this process already had a root `config.json` from a single-workspace deploy:

1. Install via OAuth (or run `/boilout-setup`) and copy the `team_id`.
2. Set `DATA_TEAM_ID=T0123ABCD` in `.env` and restart once. The app copies `./config.json` and `./quiz-responses.json` into `data/T0123ABCD/` if those files are not already there.
3. Create `data/T0123ABCD/settings.json` with that workplace’s channel and admin IDs.

The previous hardcoded IDs for the original store (replace with that workplace’s real IDs if they have changed):

```json
{
  "channels": {
    "boilout": "C08DX2NM3E3",
    "boh_general": "C087UN3UZ4J",
    "filter_reminder": "C09FJ60MC3W",
    "notify_user": "D09BQ43A9K2"
  },
  "admin_user_ids": ["U087M7E4LS3"],
  "timezone": "America/New_York"
}
```
