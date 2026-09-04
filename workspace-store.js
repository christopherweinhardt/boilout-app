const fs = require('node:fs/promises');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_TIMEZONE = 'America/New_York';

function resolveWorkspaceId({
  context = {},
  body = {},
  payload = {},
  command,
  message,
  event,
} = {}) {
  if (context.isEnterpriseInstall && context.enterpriseId) {
    return context.enterpriseId;
  }
  return (
    context.teamId ||
    body.team_id ||
    body.team?.id ||
    payload.team_id ||
    command?.team_id ||
    message?.team ||
    event?.team ||
    null
  );
}

function workspaceDir(workspaceId) {
  return path.join(DATA_DIR, workspaceId);
}

function settingsPath(workspaceId) {
  return path.join(workspaceDir(workspaceId), 'settings.json');
}

function relativeSettingsPath(workspaceId) {
  return `data/${workspaceId}/settings.json`;
}

function normalizeSettings(raw, workspaceId) {
  const channels = raw.channels || {};
  return {
    workspaceId,
    channels: {
      boilout: channels.boilout,
      boh_general: channels.boh_general,
      test_channel: channels.test_channel || channels.boh_general,
      notify_user: channels.notify_user,
    },
    admin_user_ids: Array.isArray(raw.admin_user_ids) ? raw.admin_user_ids : [],
    timezone: raw.timezone || DEFAULT_TIMEZONE,
  };
}

function isConfigured(settings) {
  return Boolean(
    settings?.channels?.boilout && settings?.channels?.boh_general,
  );
}

function isAdmin(settings, userId) {
  return Boolean(
    settings && userId && settings.admin_user_ids.includes(userId),
  );
}

function setupHelpText(workspaceId) {
  const id = workspaceId || '(unknown)';
  return [
    'This workplace is not configured yet.',
    `Workspace ID: \`${id}\``,
    `Create \`${relativeSettingsPath(id)}\` using \`data/settings.example.json\` as a template, invite the bot to those channels, then try again.`,
  ].join('\n');
}

async function loadSettings(workspaceId) {
  if (!workspaceId) return null;
  try {
    const raw = JSON.parse(
      await fs.readFile(settingsPath(workspaceId), 'utf8'),
    );
    return normalizeSettings(raw, workspaceId);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function listConfiguredWorkspaces() {
  let entries;
  try {
    entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }

  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'installations') continue;
    const settings = await loadSettings(entry.name);
    if (settings && isConfigured(settings)) {
      result.push(settings);
    }
  }
  return result;
}

async function ensureWorkspaceDir(workspaceId) {
  await fs.mkdir(workspaceDir(workspaceId), { recursive: true });
  return workspaceDir(workspaceId);
}

module.exports = {
  DATA_DIR,
  DEFAULT_TIMEZONE,
  resolveWorkspaceId,
  workspaceDir,
  settingsPath,
  relativeSettingsPath,
  isConfigured,
  isAdmin,
  setupHelpText,
  loadSettings,
  listConfiguredWorkspaces,
  ensureWorkspaceDir,
};
