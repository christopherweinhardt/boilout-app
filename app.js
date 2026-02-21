const { App } = require('@slack/bolt');
const APP_HOME = require('./views/app_home.json');
const ADD_FRYER = require('./views/add_fryer.json');
const SUBMIT_BUTTON = require('./views/submit_button.json');
const SUBMIT_BOILOUT = require('./views/submit_boilout.json');
const MACHINE_SELECTION_TYPE = require('./views/machine_selection_type.json');
const WEEKLY_SCHEDULE = require('./views/week_schedule.json');
const EMPTY_WEEKLY_SCHEDULE = require('./views/week_schedule_empty.json');
const MONTH_SCHEDULE = require('./views/month_schedule.json');
const { table } = require('table');
const cron = require('node-cron');
const { add_fryer, load, boilout, getNextBoilout, getMachineType, getConfig, getMachineTypeString, getWeekSchedule, getMonthSchedule } = require('./machines');
const { render, createSlackTableFromJson } = require('./table');

const quizData = require('./quiz-data');

const QUIZ_RESPONSES_FILE = path.join(__dirname, 'quiz-responses.json');
const QUIZ_MESSAGE_BLOCKS = (() => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'quiz_message_block.json'), 'utf8');
    const data = JSON.parse(raw);
    return data
  } catch (e) {
    console.error('Failed to load quiz_message_block.json:', e.message);
    return [];
  }
})();


// Initializes your app with your Slack app and bot token
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

function getWeekStartText(dateLike = new Date()) {
  const date = new Date(dateLike);

  // getUTCDay(): 0=Sunday, 1=Monday, ..., 6=Saturday
  const day = date.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  // if Sunday, back up 6 days; otherwise go back to Monday

  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);

  return formatDateWithOrdinal(monday);
}

function formatDateWithOrdinal(d) {
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const day = d.getDate();
  const suffix = (day % 10 === 1 && day !== 11) ? "st"
    : (day % 10 === 2 && day !== 12) ? "nd"
      : (day % 10 === 3 && day !== 13) ? "rd"
        : "th";
  return `${monthNames[d.getMonth()]} ${day}${suffix}`;
}


const CHANNEL_ID = "C08DX2NM3E3";

app.message(async ({ message, say, logger, client }) => {
  try {
    // Only react to messages from the target channel
    if (message.channel !== CHANNEL_ID) return;

    // Make sure the message has files
    if (message.files && message.files.length > 0) {
      // Check if any of the files are images
      const imageFiles = message.files.filter(f => f.mimetype?.startsWith("image/"));

      if (imageFiles.length > 0) {
        client.chat.postEphemeral({
          channel: message.channel,
          user: message.user,
          blocks: SUBMIT_BUTTON,
          text: "Fill out the form below!"
        })
      }
    }
  } catch (error) {
    logger.error(error);
  }
});
app.action('cookmode-action', async ({ ack, body, client, logger }) => {
  await ack();
})
app.action('inuse-action', async ({ ack, body, client, logger }) => {
  await ack();
})
app.action('submit_boilout', async ({ ack, body, client, logger }) => {
  await ack();
  // Update the message to reflect the action

  const modal = { ...SUBMIT_BOILOUT };
  modal.blocks[0].element.options = [];
  const config = await getConfig();
  for (var i = 0; i < config.machines.length; i++) {
    const machine = config.machines[i];
    const machine_json = { ...MACHINE_SELECTION_TYPE };
    machine_json.text = {
      type: 'plain_text',
      text: `${machine.name} (${getMachineTypeString(machine.type)})${(!machine.in_use) ? " - Not In Use" : ""}`,
      emoji: true
    };
    machine_json.value = machine.name;
    modal.blocks[0].element.options.push(machine_json);
  }
  // Use the local timezone when computing the initial date for the date picker
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  // 'en-CA' produces an ISO-like YYYY-MM-DD date string suitable for Slack's initial_date
  const formattedDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  modal.blocks[1].element.initial_date = formattedDate;

  await client.views.open({
    // Pass a valid trigger_id within 3 seconds of receiving it
    trigger_id: body.trigger_id,
    view: modal
  });
});
app.view('boilout_submit', async ({ ack, body, view, client, logger }) => {
  // Acknowledge the view_submission request
  await ack();
  const fryer_name = view['state']['values']['fryer_name']['machine-select'].selected_option.value;
  const boilout_date = view['state']['values']['boilout_date']['boilout-date-input'].selected_date;
  const more_data = view['state']['values']['more_data']['cookmode-action'].selected_options;
  const user = body['user']['id'];
  const change_cookmode = more_data.find(o => o.value == "change_cookmode") != undefined;
  const not_inuse = more_data.find(o => o.value == "not_inuse") != undefined;
  console.log(fryer_name, boilout_date, change_cookmode, not_inuse)
  // Message to send user
  let msg = '';
  // Save to DB

  const results = boilout(fryer_name, new Date(boilout_date), change_cookmode, not_inuse);

  if (!results) {
    msg = 'There was an error with your submission. Please let Chris know.';
  } else {
    await client.chat.postMessage({
      channel: "D09BQ43A9K2",
      text: `<@${user}> just submitted the boilout for ${fryer_name}`
    })
    return;
  }

  // Message the user
  try {
    await client.chat.postMessage({
      channel: user,
      text: msg
    });
  }
  catch (error) {
    logger.error(error);
  }

});

app.action('add_fryer', async ({ ack, body, client, logger }) => {
  await ack();
  // Update the message to reflect the action
  await client.views.open({
    // Pass a valid trigger_id within 3 seconds of receiving it
    trigger_id: body.trigger_id,
    view: ADD_FRYER
  });
});
// Handle a view_submission request
app.view('add_fryer_submit', async ({ ack, body, view, client, logger }) => {
  // Acknowledge the view_submission request
  await ack();
  const fryer_name = view['state']['values']['fryer_name']['fryer_name_input'].value;
  const fryer_type = view['state']['values']['fryer_type']['fryer_type_input'].selected_option.value;
  const boilout_date = view['state']['values']['boilout_date']['boilout_date_input'].selected_date;
  const user = body['user']['id']
  // Message to send user
  let msg = '';
  // Save to DB
  const results = add_fryer(fryer_name, getMachineType(Number.parseInt(fryer_type)), new Date(boilout_date));

  if (!results) {
    msg = 'There was an error with your submission';
  }

  // Message the user
  try {
    await client.chat.postMessage({
      channel: user,
      text: msg
    });
  }
  catch (error) {
    logger.error(error);
  }

});

app.action('edit_fryer', async ({ ack, body, client, logger }) => {
  await ack();
});

app.command('/week', async ({ ack, client, payload }) => {

  await ack();
  console.log('Processing /week...')

  const commandText = payload.text; // Text entered after the command
  const userId = payload.user_id;

  let date = new Date();
  let week_boilouts = await getWeekSchedule(date);

  schedule = JSON.parse(JSON.stringify(WEEKLY_SCHEDULE));
  let header = `*Week of ${getWeekStartText()}*`;
  schedule[0].text.text = header;

  if (week_boilouts.boilouts.length == 0 && week_boilouts.filter_changes.length == 0) {
    schedule = JSON.parse(JSON.stringify(EMPTY_WEEKLY_SCHEDULE));
    let header = `*Week of ${getWeekStartText()}*`;
    schedule[0].text.text = header;
    schedule[1].text.text = "No boilouts scheduled this week.";
    await app.client.chat.postEphemeral({
      channel: payload.channel_id,
      user: userId,
      text: `This weeks boilout schedule:`,
      blocks: schedule
    });
    return;
  }

  let data = [
    [``, `Monday`, 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    ['Boil Outs', ' ', ' ', ' ', ' ', ' ', ' '],
    ['Filter Changes', ' ', ' ', ' ', ' ', ' ', ' ']
  ]
  for (var i = 0; i < week_boilouts.boilouts.length; i++) {
    let boilout = week_boilouts.boilouts[i];
    let day_of_week = boilout.date.getUTCDay();
    console.log("Boilout day: " + boilout.date)
    if (day_of_week < 0)
      continue;
    data[1][day_of_week] = data[1][day_of_week].replace(' ', '');
    data[1][day_of_week] += `• ${boilout.machine.name}\n`;
  }
  for (var i = 0; i < week_boilouts.filter_changes.length; i++) {
    let filter_change = week_boilouts.filter_changes[i];
    let day_of_week = filter_change.date.getUTCDay();
    if (day_of_week < 0)
      continue;
    data[2][day_of_week] = data[2][day_of_week].replace(' ', '');
    data[2][day_of_week] += `• ${filter_change.machine.name}\n`;
  }

  // Generate the Slack Block Kit JSON
  const slackTableJson = createSlackTableFromJson(data);
  await app.client.chat.postEphemeral({
    channel: payload.channel_id,
    user: userId,
    text: `This week's boilout schedule:`,
    blocks: slackTableJson.blocks
  });
  // You can now console.log this or use it in your Slack integration
  //console.log(JSON.stringify(slackTableJson, null, 2));
  /*const dm = await app.client.conversations.open({
    users: userId // Replace with the user’s Slack ID
  });
  console.log(dm.channel.id);
  const buffer = await render([data[1], data[2]], data[0]);
  const result = await client.files.uploadV2({
    channel_id: dm.channel.id,
    file: buffer,
    filename: "table.png",
    title: "Boil Out Schedule",
  });*/
  return;
});

const boilout_schedule_entry = {
  "type": "section",
  "text": {
    "type": "mrkdwn",
    "text": "• Mario - Date"
  }
}
app.command('/month', async ({ ack, payload }) => {

  await ack();
  console.log('Processing /month...')

  const commandText = payload.text; // Text entered after the command
  const userId = payload.user_id;

  let date = new Date();
  let month_schedule = await getMonthSchedule();
  month_schedule.boilouts.sort((a, b) => new Date(a.date) - new Date(b.date));
  month_schedule.filter_changes.sort((a, b) => new Date(a.date) - new Date(b.date));

  schedule = JSON.parse(JSON.stringify(MONTH_SCHEDULE));
  if (month_schedule.boilouts.length == 0 && month_schedule.filter_changes.length == 0)
    return;

  schedule[0].text.text = `*Month of ${date.toLocaleString('default', { month: 'long' })}*`;
  let entry1 = JSON.parse(JSON.stringify(boilout_schedule_entry))
  entry1.text.text = `Boil Outs:`
  schedule.push(entry1);
  for (var i = 0; i < month_schedule.boilouts.length; i++) {
    let boilout = month_schedule.boilouts[i];
    console.log(boilout)
    let entry = JSON.parse(JSON.stringify(boilout_schedule_entry))
    entry.text.text = `• ${boilout.machine.name} - ${boilout.date.toLocaleString("en-US", { month: "long", day: "numeric" })}`
    schedule.push(entry);
  }
  let entry2 = JSON.parse(JSON.stringify(boilout_schedule_entry))
  entry2.text.text = `Filter Changes:`
  schedule.push(entry2);
  for (var i = 0; i < month_schedule.filter_changes.length; i++) {
    let filter_change = month_schedule.filter_changes[i];
    let entry = JSON.parse(JSON.stringify(boilout_schedule_entry))
    entry.text.text = `• ${filter_change.machine.name} - ${filter_change.date.toLocaleString("en-US", { month: "long", day: "numeric" })}`
    schedule.push(entry);
  }

  await app.client.chat.postEphemeral({
    channel: payload.channel_id,
    user: userId,
    text: `This months boilout schedule:`,
    blocks: schedule
  });
});

async function postWeekly(channel_id) {
  console.log("Posting weekly schedule");
  let date = new Date();
  let week_boilouts = await getWeekSchedule(date);

  schedule = JSON.parse(JSON.stringify(WEEKLY_SCHEDULE));
  let header = `*Week of ${getWeekStartText()}*`;
  schedule[0].text.text = header;

  if (week_boilouts.boilouts.length == 0 && week_boilouts.filter_changes.length == 0) {
    schedule = JSON.parse(JSON.stringify(EMPTY_WEEKLY_SCHEDULE));
    let header = `*Week of ${getWeekStartText()}*`;
    schedule[0].text.text = header;
    await app.client.chat.postMessage({
      channel: channel_id,
      text: `This weeks boilout schedule:`,
      blocks: schedule
    });
    return;
  }

  let data = [
    [``, `Monday`, 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    ['Boil Outs', ' ', ' ', ' ', ' ', ' ', ' '],
    ['Filter Changes', ' ', ' ', ' ', ' ', ' ', ' ']
  ]
  for (var i = 0; i < week_boilouts.boilouts.length; i++) {
    let boilout = week_boilouts.boilouts[i];
    let day_of_week = boilout.date.getUTCDay();
    console.log("Boilout day: " + boilout.date)
    if (day_of_week < 0)
      continue;
    data[1][day_of_week] = data[1][day_of_week].replace(' ', '');
    data[1][day_of_week] += `• ${boilout.machine.name}\n`;
  }
  for (var i = 0; i < week_boilouts.filter_changes.length; i++) {
    let filter_change = week_boilouts.filter_changes[i];
    let day_of_week = filter_change.date.getUTCDay();
    if (day_of_week < 0)
      continue;
    data[2][day_of_week] = data[2][day_of_week].replace(' ', '');
    data[2][day_of_week] += `• ${filter_change.machine.name}\n`;
  }

  console.log(data);

  // Generate the Slack Block Kit JSON
  const slackTableJson = createSlackTableFromJson(data);
  await app.client.chat.postMessage({
    channel: channel_id,
    text: `This week's boilout schedule:`,
    blocks: slackTableJson.blocks
  });
}

const MODAL_TITLE = 'BOH Quality Quiz';
const TOTAL_QUESTIONS = quizData.length;

/** Prebuilt question blocks (one per question) — computed once on load. */
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

/** Build only the result + optional next-question blocks (minimal runtime work). */
function buildModalUpdateBlocks(correct, correctAnswerText, score, total, isLast, nextIndex, feedback = []) {
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
        const questionLabel = q ? `*Question ${i + 1}:* ${q.question}` : `*Question ${i + 1}*`;
        const yourAnswer = item.chosenText ? `• You answered: *${item.chosenText}* ` : '';
        const line = item.correct
          ? `• Correct :white_check_mark:`
          : `• *Wrong* — correct answer was *${item.correctAnswerText}* :x:`;
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `${questionLabel}\n${yourAnswer}\n${line}` },
        });
      });
    }
  } else {
    blocks.push({ type: 'divider' }, ...PREBUILT_QUESTION_BLOCKS[nextIndex]);
  }

  return blocks;
}

/** Return true if this user has already completed the quiz. */
function hasCompletedQuiz(userId) {
  if (!userId) return false;
  try {
    const raw = fs.readFileSync(QUIZ_RESPONSES_FILE, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.some((entry) => entry.user_id === userId);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Error reading quiz responses:', e.message);
    return false;
  }
}

/** Append a completed quiz response to the JSON file (username, display name, score, etc.). */
function saveQuizResponse(username, displayName, userId, score, total) {
  const entry = {
    username,
    display_name: displayName,
    user_id: userId,
    score,
    total,
    completed_at: new Date().toISOString(),
  };
  let list = [];
  try {
    const raw = fs.readFileSync(QUIZ_RESPONSES_FILE, 'utf8');
    list = JSON.parse(raw);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Error reading quiz responses:', e.message);
  }
  list.push(entry);
  fs.writeFileSync(QUIZ_RESPONSES_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// Slash command: /quiz — open quiz modal
// Use trigger_id immediately (it expires in ~3s); then ack() so Slack doesn't show dispatch_failed
app.action("quiz_start", async ({ action, body, ack, client }) => {
  await ack();
  if (hasCompletedQuiz(body.user.id)) {
    try {
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: body.user.id,
        text: "You've already completed this quiz.",
      });
    } catch (err) {
      console.error('Failed to post already-completed message:', err);
    }
    return;
  }
  try {
    const privateMetadata = JSON.stringify({ questionIndex: 0, score: 0, feedback: [] });

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
    try {
      await client.chat.postEphemeral({
        channel: body.channel.id,
        user: body.user.id,
        text: `Could not open quiz: ${err.message}. Try /quiz again.`,
      });
    } catch (e) {
      console.error('Could not post ephemeral:', e);
    }
  }
});

// Only this user ID can run /quiz (post the quiz announcement).
const QUIZ_POST_ALLOWED_USER_ID = 'U087M7E4LS3';

// Slash command: /quiz — post the quiz announcement message (from quiz_message_block.json) to the channel
app.command("/quiz", async ({ command, ack, client }) => {
  await ack();
  if (command.user_id !== QUIZ_POST_ALLOWED_USER_ID) {
    try {
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: "You don't have permission to run this command.",
      });
    } catch (err) {
      console.error('Failed to post permission-denied message:', err);
    }
    return;
  }
  if (QUIZ_MESSAGE_BLOCKS.length === 0) {
    try {
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: 'Quiz message blocks could not be loaded. Check quiz_message_block.json.',
      });
    } catch (err) {
      console.error('Failed to post ephemeral:', err);
    }
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
    try {
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `Failed to post quiz message: ${err.message}`,
      });
    } catch (e) {
      console.error('Could not post ephemeral:', e);
    }
  }
});

// Handle answer button clicks in the modal (replace view each time)
app.action(/^quiz_answer_(.+)_(.+)$/, async ({ action, body, ack, client }) => {
  await ack();

  const view = body.view;
  if (!view || view.type !== 'modal') return;
  const [, questionId, selectedValue] = action.action_id.match(/^quiz_answer_(.+)_(.+)$/);
  let state = { questionIndex: 0, score: 0, feedback: [] };
  try {
    if (view.private_metadata) state = JSON.parse(view.private_metadata);
  } catch (_) {}
  state.feedback = state.feedback || [];

  const question = quizData.find((q) => q.id === questionId);
  if (!question) return;
  const correctOption = question.options.find((o) => o.correct);
  const chosen = question.options.find((o) => o.value === selectedValue);
  const correct = chosen && chosen.correct;
  const newScore = state.score + (correct ? 1 : 0);
  const totalAnswered = state.questionIndex + 1;
  const isLast = totalAnswered >= quizData.length;

  const chosenText = chosen ? chosen.text : '';
  const newFeedback = [...state.feedback, { correct, correctAnswerText: correctOption ? correctOption.text : '', chosenText }];
  const nextIndex = state.questionIndex + 1;
  const blocks = buildModalUpdateBlocks(
    correct,
    correctOption ? correctOption.text : '',
    newScore,
    totalAnswered,
    isLast,
    nextIndex,
    isLast ? newFeedback : undefined
  );

  const privateMetadata = isLast ? '{}' : JSON.stringify({ questionIndex: nextIndex, score: newScore, feedback: newFeedback });

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
        displayName = res.user?.real_name ?? res.user?.profile?.display_name ?? username;
      }
    } catch (_) {}
    try {
      saveQuizResponse(username, displayName, userId, newScore, totalAnswered);
    } catch (err) {
      console.error('Failed to save quiz response:', err);
    }
  }
});

app.event('app_home_opened', async ({ event, client, logger }) => {
  try {
    const result = await client.views.publish({
      // Use the user ID associated with the event
      user_id: event.user,
      view: APP_HOME
    });
    if (!result.ok) {
      console.log("failed to publish home view");
    }
  }
  catch (error) {
    logger.error(error);
  }
});

(async () => {
  await load();

  // Start your app
  await app.start();

  cron.schedule('0 9 * * 1', () => { postWeekly(CHANNEL_ID) }, { timezone: "America/New_York" });

  app.logger.info('Boilout Bot is running!');
})();
