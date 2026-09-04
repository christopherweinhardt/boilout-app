const { App } = require('@slack/bolt');
const fs = require('node:fs');
const path = require('node:path');
const APP_HOME = require('./views/app_home.json');
const ADD_FRYER = require('./views/add_fryer.json');
const SUBMIT_BUTTON = require('./views/submit_button.json');
const SUBMIT_BOILOUT = require('./views/submit_boilout.json');
const MACHINE_SELECTION_TYPE = require('./views/machine_selection_type.json');
const WEEKLY_SCHEDULE = require('./views/week_schedule.json');
const EMPTY_WEEKLY_SCHEDULE = require('./views/week_schedule_empty.json');
const MONTH_SCHEDULE = require('./views/month_schedule.json');
const cron = require('node-cron');
const {
  add_fryer,
  boilout,
  getMachineType,
  getConfig,
  getMachineTypeString,
  getWeekSchedule,
  getMonthSchedule,
  getTodayFilterChanges,
  toScheduleDateString,
  getTodayDateString,
  migrateLegacyConfig,
  migrateLegacyQuizFiles,
} = require('./machines');
const { createSlackTableFromJson } = require('./table');
const {
  DATA_DIR,
  DEFAULT_TIMEZONE,
  resolveWorkspaceId,
  relativeSettingsPath,
  isConfigured,
  isAdmin,
  setupHelpText,
  loadSettings,
  listConfiguredWorkspaces,
} = require('./workspace-store');
const { createInstallationStore } = require('./installation-store');

const quizData = require('./quiz-data');

const BOT_SCOPES = [
  'channels:history',
  'groups:history',
  'chat:write',
  'files:read',
  'users:read',
  'im:write',
  'commands',
];

const QUIZ_MESSAGE_BLOCKS = (() => {
  try {
    const raw = fs.readFileSync(
      path.join(__dirname, 'quiz_message_block.json'),
      'utf8',
    );
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load quiz_message_block.json:', e.message);
    return [];
  }
})();

const requiredEnv = [
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
  'SLACK_STATE_SECRET',
  'SLACK_APP_TOKEN',
];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(
      `Missing required env var ${key}. Copy .env.example to .env and fill in your Slack app credentials.`,
    );
  }
}

const installationStore = createInstallationStore(
  path.join(DATA_DIR, 'installations'),
);

function sendHtml(res, html, status = 200) {
  if (typeof res.send === 'function') {
    res.status(status).send(html);
    return;
  }
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function oauthSuccessHtml(workspaceId) {
  const settingsFile = relativeSettingsPath(workspaceId || 'TEAM_ID');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Boilout app installed</title></head>
<body style="font-family: sans-serif; max-width: 40rem; margin: 2rem auto; line-height: 1.5;">
  <h1>Installation succeeded</h1>
  <p>Workspace ID: <code>${workspaceId || '(unknown)'}</code></p>
  <p>Create <code>${settingsFile}</code> from <code>data/settings.example.json</code>, invite the bot to those channels, then run <code>/boilout-setup</code> in Slack to confirm.</p>
  <p>Add fryers from the App Home tab.</p>
</body>
</html>`;
}

const appOptions = {
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  scopes: BOT_SCOPES,
  installationStore,
  port: Number(process.env.PORT) || 3000,
  installerOptions: {
    installPath: '/slack/install',
    redirectUriPath: '/slack/oauth_redirect',
    callbackOptions: {
      success: (installation, _opts, _req, res) => {
        const workspaceId = installation.isEnterpriseInstall
          ? installation.enterprise?.id
          : installation.team?.id;
        sendHtml(res, oauthSuccessHtml(workspaceId));
      },
      failure: (error, _opts, _req, res) => {
        sendHtml(
          res,
          `<p>Installation failed: ${error?.message || 'unknown error'}</p>`,
          500,
        );
      },
    },
  },
};

if (process.env.SLACK_REDIRECT_URI) {
  appOptions.redirectUri = process.env.SLACK_REDIRECT_URI;
}

const app = new App(appOptions);

function getWeekStartText(dateLike = new Date()) {
  const date = new Date(dateLike);

  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;

  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);

  return formatDateWithOrdinal(monday);
}

function formatDateWithOrdinal(d) {
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const day = d.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? 'st'
      : day % 10 === 2 && day !== 12
        ? 'nd'
        : day % 10 === 3 && day !== 13
          ? 'rd'
          : 'th';
  return `${monthNames[d.getMonth()]} ${day}${suffix}`;
}

function formatScheduleDate(d) {
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${monthNames[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function quizResponsesFile(teamId) {
  return path.join(DATA_DIR, teamId, 'quiz-responses.json');
}

function questionStatsFile(teamId) {
  return path.join(DATA_DIR, teamId, 'question-stats.json');
}

async function postEphemeralSafe(client, { channel, user, text, blocks }) {
  try {
    await client.chat.postEphemeral({ channel, user, text, blocks });
  } catch (err) {
    console.error('Failed to post ephemeral:', err);
  }
}

async function requireConfiguredSettings(teamId, client, channel, user) {
  const settings = await loadSettings(teamId);
  if (settings && isConfigured(settings)) return settings;
  if (client && channel && user) {
    await postEphemeralSafe(client, {
      channel,
      user,
      text: setupHelpText(teamId),
    });
  }
  return null;
}

async function getBotToken(workspaceId) {
  const installation = await installationStore.fetchInstallation({
    teamId: workspaceId,
    enterpriseId: workspaceId,
    isEnterpriseInstall: false,
  });
  return installation?.bot?.token;
}

app.message(async ({ message, logger, client, context }) => {
  try {
    if (message.subtype || message.bot_id) return;
    const teamId = resolveWorkspaceId({ context, message });
    const settings = await loadSettings(teamId);
    if (!settings || message.channel !== settings.channels.boilout) return;

    if (message.files && message.files.length > 0) {
      const imageFiles = message.files.filter((f) =>
        f.mimetype?.startsWith('image/'),
      );

      if (imageFiles.length > 0) {
        client.chat.postEphemeral({
          channel: message.channel,
          user: message.user,
          blocks: SUBMIT_BUTTON,
          text: 'Fill out the form below!',
        });
      }
    }
  } catch (error) {
    logger.error(error);
  }
});

app.action('cookmode-action', async ({ ack }) => {
  await ack();
});
app.action('inuse-action', async ({ ack }) => {
  await ack();
});
app.action('submit_boilout', async ({ ack, body, client, context }) => {
  await ack();

  const teamId = resolveWorkspaceId({ context, body });
  const modal = { ...SUBMIT_BOILOUT };
  modal.blocks[0].element.options = [];
  const config = await getConfig(teamId);
  for (let i = 0; i < config.machines.length; i++) {
    const machine = config.machines[i];
    const machine_json = { ...MACHINE_SELECTION_TYPE };
    machine_json.text = {
      type: 'plain_text',
      text: `${machine.name} (${getMachineTypeString(machine.type)})${!machine.in_use ? ' - Not In Use' : ''}`,
      emoji: true,
    };
    machine_json.value = machine.name;
    modal.blocks[0].element.options.push(machine_json);
  }
  const settings = await loadSettings(teamId);
  const timezone =
    settings?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';
  const formattedDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
  }).format(new Date());
  modal.blocks[1].element.initial_date = formattedDate;

  await client.views.open({
    trigger_id: body.trigger_id,
    view: modal,
  });
});

app.view(
  'boilout_submit',
  async ({ ack, body, view, client, logger, context }) => {
    await ack();
    const teamId = resolveWorkspaceId({ context, body });
    const fryer_name =
      view.state.values.fryer_name['machine-select'].selected_option.value;
    const boilout_date =
      view.state.values.boilout_date['boilout-date-input'].selected_date;
    const more_data =
      view.state.values.more_data['cookmode-action'].selected_options;
    const user = body.user.id;
    const change_cookmode =
      more_data.find((o) => o.value === 'change_cookmode') !== undefined;
    const not_inuse =
      more_data.find((o) => o.value === 'not_inuse') !== undefined;
    console.log(fryer_name, boilout_date, change_cookmode, not_inuse);

    let msg = '';
    const results = await boilout(
      teamId,
      fryer_name,
      boilout_date,
      change_cookmode,
      not_inuse,
    );

    if (!results) {
      msg = 'There was an error with your submission. Please let Chris know.';
    } else {
      const settings = await loadSettings(teamId);
      const notify = settings?.channels?.notify_user;
      if (notify) {
        await client.chat.postMessage({
          channel: notify,
          text: `<@${user}> just submitted the boilout for ${fryer_name}`,
        });
      }
      return;
    }

    try {
      await client.chat.postMessage({
        channel: user,
        text: msg,
      });
    } catch (error) {
      logger.error(error);
    }
  },
);

app.action('add_fryer', async ({ ack, body, client }) => {
  await ack();
  await client.views.open({
    trigger_id: body.trigger_id,
    view: ADD_FRYER,
  });
});

app.view(
  'add_fryer_submit',
  async ({ ack, body, view, client, logger, context }) => {
    await ack();
    const teamId = resolveWorkspaceId({ context, body });
    const fryer_name = view.state.values.fryer_name.fryer_name_input.value;
    const fryer_type =
      view.state.values.fryer_type.fryer_type_input.selected_option.value;
    const boilout_date =
      view.state.values.boilout_date.boilout_date_input.selected_date;
    const user = body.user.id;
    let msg = '';
    const results = await add_fryer(
      teamId,
      fryer_name,
      getMachineType(Number.parseInt(fryer_type, 10)),
      new Date(boilout_date),
    );

    if (!results) {
      msg = 'There was an error with your submission';
    } else {
      msg = `Added fryer ${fryer_name}.`;
    }

    try {
      await client.chat.postMessage({
        channel: user,
        text: msg,
      });
    } catch (error) {
      logger.error(error);
    }
  },
);

app.action('edit_fryer', async ({ ack }) => {
  await ack();
});

app.command('/week', async ({ ack, client, payload, context, command }) => {
  await ack();
  console.log('Processing /week...');

  const teamId = resolveWorkspaceId({ context, payload, command });
  const settings = await requireConfiguredSettings(
    teamId,
    client,
    payload.channel_id,
    payload.user_id,
  );
  if (!settings) return;

  const userId = payload.user_id;
  const date = new Date();
  const week_boilouts = await getWeekSchedule(teamId, date);

  let schedule = JSON.parse(JSON.stringify(WEEKLY_SCHEDULE));
  let header = `*Week of ${getWeekStartText()}*`;
  schedule[0].text.text = header;

  if (
    week_boilouts.boilouts.length === 0 &&
    week_boilouts.filter_changes.length === 0
  ) {
    schedule = JSON.parse(JSON.stringify(EMPTY_WEEKLY_SCHEDULE));
    header = `*Week of ${getWeekStartText()}*`;
    schedule[0].text.text = header;
    schedule[1].text.text = 'No boilouts scheduled this week.';
    await client.chat.postEphemeral({
      channel: payload.channel_id,
      user: userId,
      text: 'This weeks boilout schedule:',
      blocks: schedule,
    });
    return;
  }

  const data = [
    ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    ['Boil Outs', ' ', ' ', ' ', ' ', ' ', ' '],
    ['Filter Changes', ' ', ' ', ' ', ' ', ' ', ' '],
  ];
  for (let i = 0; i < week_boilouts.boilouts.length; i++) {
    const item = week_boilouts.boilouts[i];
    const day_of_week = item.date.getUTCDay();
    console.log(`Boilout day: ${item.date}`);
    if (day_of_week < 0) continue;
    data[1][day_of_week] = data[1][day_of_week].replace(' ', '');
    data[1][day_of_week] += `• ${item.machine.name}\n`;
  }
  for (let i = 0; i < week_boilouts.filter_changes.length; i++) {
    const filter_change = week_boilouts.filter_changes[i];
    const day_of_week = filter_change.date.getUTCDay();
    if (day_of_week < 0) continue;
    data[2][day_of_week] = data[2][day_of_week].replace(' ', '');
    data[2][day_of_week] += `• ${filter_change.machine.name}\n`;
  }

  const slackTableJson = createSlackTableFromJson(data);
  await client.chat.postEphemeral({
    channel: payload.channel_id,
    user: userId,
    text: "This week's boilout schedule:",
    blocks: slackTableJson.blocks,
  });
});

const boilout_schedule_entry = {
  type: 'section',
  text: {
    type: 'mrkdwn',
    text: '• Mario - Date',
  },
};

app.command('/month', async ({ ack, client, payload, context, command }) => {
  await ack();
  console.log('Processing /month...');

  const teamId = resolveWorkspaceId({ context, payload, command });
  const settings = await requireConfiguredSettings(
    teamId,
    client,
    payload.channel_id,
    payload.user_id,
  );
  if (!settings) return;

  const userId = payload.user_id;
  const date = new Date();
  const month_schedule = await getMonthSchedule(teamId);
  month_schedule.boilouts.sort((a, b) => new Date(a.date) - new Date(b.date));
  month_schedule.filter_changes.sort(
    (a, b) => new Date(a.date) - new Date(b.date),
  );

  const schedule = JSON.parse(JSON.stringify(MONTH_SCHEDULE));
  if (
    month_schedule.boilouts.length === 0 &&
    month_schedule.filter_changes.length === 0
  ) {
    return;
  }

  schedule[0].text.text = `*Month of ${date.toLocaleString('default', { month: 'long' })}*`;
  const entry1 = JSON.parse(JSON.stringify(boilout_schedule_entry));
  entry1.text.text = 'Boil Outs:';
  schedule.push(entry1);
  for (let i = 0; i < month_schedule.boilouts.length; i++) {
    const item = month_schedule.boilouts[i];
    console.log(item);
    const entry = JSON.parse(JSON.stringify(boilout_schedule_entry));
    entry.text.text = `• ${item.machine.name} - ${formatScheduleDate(item.date)}`;
    schedule.push(entry);
  }
  const entry2 = JSON.parse(JSON.stringify(boilout_schedule_entry));
  entry2.text.text = 'Filter Changes:';
  schedule.push(entry2);
  for (let i = 0; i < month_schedule.filter_changes.length; i++) {
    const filter_change = month_schedule.filter_changes[i];
    const entry = JSON.parse(JSON.stringify(boilout_schedule_entry));
    entry.text.text = `• ${filter_change.machine.name} - ${formatScheduleDate(filter_change.date)}`;
    schedule.push(entry);
  }

  await client.chat.postEphemeral({
    channel: payload.channel_id,
    user: userId,
    text: 'This months boilout schedule:',
    blocks: schedule,
  });
});

function formatBusinessCalendarDate(ymd) {
  const [, month, day] = ymd.split('-').map(Number);
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${monthNames[month - 1]} ${day}`;
}

function parseFilterReminderDate(text, timezone = DEFAULT_TIMEZONE) {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return { date: getTodayDateString(new Date(), timezone), error: null };
  }

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return {
      date: null,
      error:
        'Invalid date. Use YYYY-MM-DD (e.g. 2026-06-22) or leave blank for today.',
    };
  }

  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return { date: null, error: 'Invalid date.' };
  }

  return { date, error: null };
}

async function postFilterChangeReminders({
  teamId,
  channelId,
  token,
  client,
  date,
  timezone = DEFAULT_TIMEZONE,
}) {
  const due_filters = await getTodayFilterChanges(teamId, date, timezone);
  if (due_filters.length === 0) {
    return { posted: false, filters: [], date };
  }

  const machineNames = due_filters.map((f) => `*${f.machine.name}*`).join(', ');
  const todayStr = getTodayDateString(new Date(), timezone);
  const dateLabel =
    date === todayStr ? 'today' : `on ${formatBusinessCalendarDate(date)}`;
  const text =
    due_filters.length === 1
      ? `<!channel> Filter change due ${dateLabel} for ${machineNames}. Please complete the filter change.`
      : `<!channel> Filter changes due ${dateLabel} for ${machineNames}. Please complete the filter changes.`;

  const payload = {
    channel: channelId,
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
    ],
  };
  if (token) payload.token = token;

  const api = client || app.client;
  await api.chat.postMessage(payload);
  return { posted: true, filters: due_filters, date };
}

async function postWeekly({ teamId, channelId, token }) {
  console.log(`Posting weekly schedule for ${teamId}`);
  const date = new Date();
  const week_boilouts = await getWeekSchedule(teamId, date);

  let schedule = JSON.parse(JSON.stringify(WEEKLY_SCHEDULE));
  let header = `*Week of ${getWeekStartText()}*`;
  schedule[0].text.text = header;

  const message = {
    channel: channelId,
    text: 'This weeks boilout schedule:',
  };
  if (token) message.token = token;

  if (
    week_boilouts.boilouts.length === 0 &&
    week_boilouts.filter_changes.length === 0
  ) {
    schedule = JSON.parse(JSON.stringify(EMPTY_WEEKLY_SCHEDULE));
    header = `*Week of ${getWeekStartText()}*`;
    schedule[0].text.text = header;
    await app.client.chat.postMessage({ ...message, blocks: schedule });
    return;
  }

  const data = [
    ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    ['Boil Outs', ' ', ' ', ' ', ' ', ' ', ' '],
    ['Filter Changes', ' ', ' ', ' ', ' ', ' ', ' '],
  ];
  for (let i = 0; i < week_boilouts.boilouts.length; i++) {
    const item = week_boilouts.boilouts[i];
    const day_of_week = item.date.getUTCDay();
    console.log(`Boilout day: ${item.date}`);
    if (day_of_week < 0) continue;
    data[1][day_of_week] = data[1][day_of_week].replace(' ', '');
    data[1][day_of_week] += `• ${item.machine.name}\n`;
  }
  for (let i = 0; i < week_boilouts.filter_changes.length; i++) {
    const filter_change = week_boilouts.filter_changes[i];
    const day_of_week = filter_change.date.getUTCDay();
    if (day_of_week < 0) continue;
    data[2][day_of_week] = data[2][day_of_week].replace(' ', '');
    data[2][day_of_week] += `• ${filter_change.machine.name}\n`;
  }

  console.log(data);

  const slackTableJson = createSlackTableFromJson(data);
  await app.client.chat.postMessage({
    ...message,
    text: "This week's boilout schedule:",
    blocks: slackTableJson.blocks,
  });
}

function updateQuestionStats(teamId, feedback) {
  if (!Array.isArray(feedback) || feedback.length === 0) return;
  const file = questionStatsFile(teamId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let stats = [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    stats = JSON.parse(raw);
  } catch (e) {
    if (e.code !== 'ENOENT')
      console.error('Error reading question stats:', e.message);
  }
  while (stats.length < feedback.length) {
    stats.push({ correct: 0, total: 0 });
  }
  feedback.forEach((item, i) => {
    stats[i] = stats[i] || { correct: 0, total: 0 };
    stats[i].total += 1;
    if (item.correct) stats[i].correct += 1;
  });
  fs.writeFileSync(file, JSON.stringify(stats, null, 2), 'utf8');
}

const MODAL_TITLE = 'BOH Quality Quiz';
const TOTAL_QUESTIONS = quizData.length;

const PREBUILT_QUESTION_BLOCKS = quizData.map((question, questionIndex) => [
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Question ${questionIndex + 1} of ${TOTAL_QUESTIONS}*\n\n${question.question}`,
    },
    ...(question.image_url && {
      accessory: {
        type: 'image',
        image_url: question.image_url,
        alt_text: question.image_alt || 'Question image',
      },
    }),
  },
  {
    type: 'actions',
    block_id: 'answer_actions',
    elements: question.options.map((opt) => ({
      type: 'button',
      text: { type: 'plain_text', text: opt.text, emoji: true },
      action_id: `quiz_answer_${question.id}_${opt.value}`,
      value: opt.value,
    })),
  },
]);

function buildModalUpdateBlocks(
  correct,
  correctAnswerText,
  score,
  total,
  isLast,
  nextIndex,
  feedback = [],
) {
  const emoji = correct ? ':white_check_mark:' : ':x:';
  const resultLine = correct
    ? `*Correct!* ${emoji}  ·  Score: *${score} / ${total}*`
    : `*Wrong.* The correct answer was: ${correctAnswerText} ${emoji}  ·  Score: *${score} / ${total}*`;

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: resultLine } },
  ];

  if (isLast) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:tada: *Quiz complete!* Final score: *${score} / ${total}*`,
      },
    });
    if (feedback.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Summary of your responses:*',
        },
      });
      feedback.forEach((item, i) => {
        const q = quizData[i];
        const questionLabel = q
          ? `*Question ${i + 1}:* ${q.question}`
          : `*Question ${i + 1}*`;
        const yourAnswer = item.chosenText
          ? `• You answered: *${item.chosenText}* `
          : '';
        const line = item.correct
          ? '• Correct :white_check_mark:'
          : `• *Wrong* — correct answer was *${item.correctAnswerText}* :x:`;
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${questionLabel}\n${yourAnswer}\n${line}`,
          },
        });
      });
    }
  } else {
    blocks.push({ type: 'divider' }, ...PREBUILT_QUESTION_BLOCKS[nextIndex]);
  }

  return blocks;
}

function hasCompletedQuiz(teamId, userId) {
  if (!userId || !teamId) return false;
  try {
    const raw = fs.readFileSync(quizResponsesFile(teamId), 'utf8');
    const list = JSON.parse(raw);
    return (
      Array.isArray(list) && list.some((entry) => entry.user_id === userId)
    );
  } catch (e) {
    if (e.code !== 'ENOENT')
      console.error('Error reading quiz responses:', e.message);
    return false;
  }
}

function saveQuizResponse(teamId, username, displayName, userId, score, total) {
  const entry = {
    username,
    display_name: displayName,
    user_id: userId,
    score,
    total,
    completed_at: new Date().toISOString(),
  };
  let list = [];
  const file = quizResponsesFile(teamId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const raw = fs.readFileSync(file, 'utf8');
    list = JSON.parse(raw);
  } catch (e) {
    if (e.code !== 'ENOENT')
      console.error('Error reading quiz responses:', e.message);
  }
  list.push(entry);
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
}

app.action('quiz_start', async ({ body, ack, client, context }) => {
  await ack();
  const teamId = resolveWorkspaceId({ context, body });
  if (hasCompletedQuiz(teamId, body.user.id)) {
    await postEphemeralSafe(client, {
      channel: body.channel.id,
      user: body.user.id,
      text: "You've already completed this quiz.",
    });
    return;
  }
  try {
    const privateMetadata = JSON.stringify({
      questionIndex: 0,
      score: 0,
      feedback: [],
      teamId,
    });

    await client.views.open({
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: MODAL_TITLE, emoji: true },
        blocks: PREBUILT_QUESTION_BLOCKS[0],
        private_metadata: privateMetadata,
      },
      trigger_id: body.trigger_id,
    });
  } catch (err) {
    console.error('Quiz open modal error:', err);
    await postEphemeralSafe(client, {
      channel: body.channel.id,
      user: body.user.id,
      text: `Could not open quiz: ${err.message}. Try /quiz again.`,
    });
  }
});

app.command('/quiz', async ({ command, ack, client, context }) => {
  await ack();
  const teamId = resolveWorkspaceId({ context, command });
  const settings = await requireConfiguredSettings(
    teamId,
    client,
    command.channel_id,
    command.user_id,
  );
  if (!settings) return;

  if (!isAdmin(settings, command.user_id)) {
    await postEphemeralSafe(client, {
      channel: command.channel_id,
      user: command.user_id,
      text: "You don't have permission to run this command.",
    });
    return;
  }
  if (QUIZ_MESSAGE_BLOCKS.length === 0) {
    await postEphemeralSafe(client, {
      channel: command.channel_id,
      user: command.user_id,
      text: 'Quiz message blocks could not be loaded. Check quiz_message_block.json.',
    });
    return;
  }
  try {
    await client.chat.postMessage({
      channel: command.channel_id,
      text: 'Monthly Quality Report – Please complete the quiz.',
      blocks: QUIZ_MESSAGE_BLOCKS,
    });
  } catch (err) {
    console.error('Quiz-post error:', err);
    await postEphemeralSafe(client, {
      channel: command.channel_id,
      user: command.user_id,
      text: `Failed to post quiz message: ${err.message}`,
    });
  }
});

app.command('/filter-reminder', async ({ command, ack, client, context }) => {
  await ack();
  const teamId = resolveWorkspaceId({ context, command });
  const settings = await requireConfiguredSettings(
    teamId,
    client,
    command.channel_id,
    command.user_id,
  );
  if (!settings) return;

  if (!isAdmin(settings, command.user_id)) {
    await postEphemeralSafe(client, {
      channel: command.channel_id,
      user: command.user_id,
      text: "You don't have permission to run this command.",
    });
    return;
  }
  try {
    const timezone = settings.timezone || DEFAULT_TIMEZONE;
    const { date, error } = parseFilterReminderDate(command.text, timezone);
    if (error) {
      await postEphemeralSafe(client, {
        channel: command.channel_id,
        user: command.user_id,
        text: error,
      });
      return;
    }

    const reminderChannel = settings.channels.test_channel;
    const result = await postFilterChangeReminders({
      teamId,
      channelId: reminderChannel,
      client,
      date,
      timezone,
    });
    const todayStr = getTodayDateString(new Date(), timezone);
    const dateLabel =
      date === todayStr ? 'today' : formatBusinessCalendarDate(date);
    if (!result.posted) {
      const week = await getWeekSchedule(teamId, new Date());
      let hint = `No filter changes are due on ${dateLabel} — nothing was posted.`;
      if (week.filter_changes.length > 0) {
        const upcoming = week.filter_changes
          .map(
            (f) => `• ${f.machine.name} — \`${toScheduleDateString(f.date)}\``,
          )
          .join('\n');
        hint += `\n\nFilter changes this week (use the date with /filter-reminder):\n${upcoming}`;
      }
      await postEphemeralSafe(client, {
        channel: command.channel_id,
        user: command.user_id,
        text: hint,
      });
      return;
    }
    const names = result.filters.map((f) => f.machine.name).join(', ');
    await postEphemeralSafe(client, {
      channel: command.channel_id,
      user: command.user_id,
      text: `Posted filter change reminder to <#${reminderChannel}> for ${dateLabel}: ${names}`,
    });
  } catch (err) {
    console.error('Filter-reminder error:', err);
    await postEphemeralSafe(client, {
      channel: command.channel_id,
      user: command.user_id,
      text: `Failed to post filter reminder: ${err.message}`,
    });
  }
});

app.command('/boilout-setup', async ({ command, ack, client, context }) => {
  await ack();
  const teamId = resolveWorkspaceId({ context, command });
  const settings = await loadSettings(teamId);
  const configured = isConfigured(settings);
  let configExists = false;
  try {
    fs.accessSync(path.join(DATA_DIR, teamId || '_', 'config.json'));
    configExists = true;
  } catch (_) {}

  const lines = [
    `Workspace ID: \`${teamId || '(unknown)'}\``,
    `Settings file: \`${relativeSettingsPath(teamId || 'TEAM_ID')}\``,
    `Settings configured: ${configured ? 'yes' : 'no'}`,
    `Fryer config.json: ${configExists ? 'present' : 'will be created on first use'}`,
  ];
  if (configured) {
    lines.push(
      `Boilout channel: <#${settings.channels.boilout}>`,
      `BOH channel: <#${settings.channels.boh_general}>`,
      `Filter reminder channel: <#${settings.channels.test_channel}>`,
      `Notify: ${settings.channels.notify_user || '(not set)'}`,
      `Admins: ${settings.admin_user_ids.map((id) => `<@${id}>`).join(', ') || '(none)'}`,
      `Timezone: ${settings.timezone}`,
    );
  } else {
    lines.push(setupHelpText(teamId));
  }

  await postEphemeralSafe(client, {
    channel: command.channel_id,
    user: command.user_id,
    text: lines.join('\n'),
  });
});

app.action(
  /^quiz_answer_(.+)_(.+)$/,
  async ({ action, body, ack, client, context }) => {
    await ack();

    const view = body.view;
    if (!view || view.type !== 'modal') return;
    const [, questionId, selectedValue] = action.action_id.match(
      /^quiz_answer_(.+)_(.+)$/,
    );
    let state = { questionIndex: 0, score: 0, feedback: [] };
    try {
      if (view.private_metadata) state = JSON.parse(view.private_metadata);
    } catch (_) {}
    state.feedback = state.feedback || [];

    const teamId = state.teamId || resolveWorkspaceId({ context, body });
    const question = quizData.find((q) => q.id === questionId);
    if (!question) return;
    const correctOption = question.options.find((o) => o.correct);
    const chosen = question.options.find((o) => o.value === selectedValue);
    const correct = chosen?.correct;
    const newScore = state.score + (correct ? 1 : 0);
    const totalAnswered = state.questionIndex + 1;
    const isLast = totalAnswered >= quizData.length;

    const chosenText = chosen ? chosen.text : '';
    const newFeedback = [
      ...state.feedback,
      {
        correct,
        correctAnswerText: correctOption ? correctOption.text : '',
        chosenText,
      },
    ];
    const nextIndex = state.questionIndex + 1;
    const blocks = buildModalUpdateBlocks(
      correct,
      correctOption ? correctOption.text : '',
      newScore,
      totalAnswered,
      isLast,
      nextIndex,
      isLast ? newFeedback : undefined,
    );

    const privateMetadata = isLast
      ? JSON.stringify({ teamId })
      : JSON.stringify({
          questionIndex: nextIndex,
          score: newScore,
          feedback: newFeedback,
          teamId,
        });

    await client.views.update({
      view_id: view.id,
      hash: view.hash,
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: MODAL_TITLE, emoji: true },
        blocks,
        private_metadata: privateMetadata,
      },
    });

    if (isLast) {
      const userId = body.user?.id ?? '';
      const username = (body.user?.name ?? userId) || 'unknown';
      let displayName = username;
      try {
        if (userId) {
          const res = await client.users.info({ user: userId });
          displayName =
            res.user?.real_name ?? res.user?.profile?.display_name ?? username;
        }
      } catch (_) {}
      try {
        saveQuizResponse(
          teamId,
          username,
          displayName,
          userId,
          newScore,
          totalAnswered,
        );
        updateQuestionStats(teamId, newFeedback);
      } catch (err) {
        console.error('Failed to save quiz response:', err);
      }
    }
  },
);

app.event('app_home_opened', async ({ event, client, logger }) => {
  try {
    const result = await client.views.publish({
      user_id: event.user,
      view: APP_HOME,
    });
    if (!result.ok) {
      console.log('failed to publish home view');
    }
  } catch (error) {
    logger.error(error);
  }
});

async function runForConfiguredWorkspaces(fn, label) {
  const workspaces = await listConfiguredWorkspaces();
  for (const settings of workspaces) {
    try {
      const token = await getBotToken(settings.workspaceId);
      await fn(settings, token);
    } catch (err) {
      console.error(`${label} failed for ${settings.workspaceId}:`, err);
    }
  }
}

(async () => {
  const migrateTeamId = process.env.DATA_TEAM_ID;
  if (migrateTeamId) {
    await migrateLegacyConfig(migrateTeamId);
    await migrateLegacyQuizFiles(migrateTeamId);
  }

  await app.start();

  cron.schedule(
    '0 9 * * 1',
    () => {
      runForConfiguredWorkspaces(
        (settings, token) =>
          postWeekly({
            teamId: settings.workspaceId,
            channelId: settings.channels.boilout,
            token,
          }),
        'weekly schedule',
      );
    },
    { timezone: DEFAULT_TIMEZONE },
  );

  cron.schedule(
    '0 18 * * *',
    () => {
      runForConfiguredWorkspaces(
        (settings, token) =>
          postFilterChangeReminders({
            teamId: settings.workspaceId,
            channelId: settings.channels.boh_general,
            token,
            date: getTodayDateString(new Date(), settings.timezone),
            timezone: settings.timezone,
          }),
        'filter reminders',
      );
    },
    { timezone: DEFAULT_TIMEZONE },
  );

  const port = Number(process.env.PORT) || 3000;
  app.logger.info(
    `Boilout Bot is running. Install at http://localhost:${port}/slack/install`,
  );
})();
