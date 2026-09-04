const fs = require('node:fs/promises');
const path = require('node:path');
const {
  workspaceDir,
  ensureWorkspaceDir,
  DEFAULT_TIMEZONE,
} = require('./workspace-store');

const MachineType = {
  OPEN: 0,
  PRESSURE: 1,
  POTATO: 2,
};

const MachineConfig = {
  name: '',
  type: MachineType.OPEN,
  last_boilout: new Date(),
  next_boilout: new Date(),
  next_filter_changes: [],
  in_use: true,
};

const GeneralConfig = {
  machines: [],
  time_periods: {
    0: 36,
    1: 30,
    2: 15,
  },
};

const configs = new Map();

function configPath(teamId) {
  return path.join(workspaceDir(teamId), 'config.json');
}

/**
 * Get `MachineType` from index
 * @param {number} index
 */
function getMachineType(index) {
  switch (index) {
    case 0:
      return MachineType.OPEN;
    case 1:
      return MachineType.PRESSURE;
    case 2:
      return MachineType.POTATO;
    default:
      return null;
  }
}

function getMachineTypeString(type) {
  switch (type) {
    case MachineType.OPEN:
      return 'Open';
    case MachineType.PRESSURE:
      return 'Pressure';
    case MachineType.POTATO:
      return 'Potato';
    default:
      return '';
  }
}

function emptyConfig() {
  return {
    machines: [],
    time_periods: { ...GeneralConfig.time_periods },
  };
}

function getWorkspaceConfig(teamId) {
  const config = configs.get(teamId);
  if (!config) {
    throw new Error(`Fryer config is not loaded for workspace ${teamId}`);
  }
  return config;
}

// Robust helper — accepts Date | string | number and supports negative days
function addBusinessDays(dateLike, days) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid date input');

  const result = new Date(date.valueOf());
  const step = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);

  while (remaining > 0) {
    result.setDate(result.getDate() + step);
    if (result.getUTCDay() !== 0) {
      remaining--;
    }
  }

  if (result.getUTCDay() === 0) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

/** Calendar date (YYYY-MM-DD) for schedule entries — matches /week column logic (UTC). */
function toScheduleDateString(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Today's calendar date in the given business timezone. */
function getTodayDateString(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
    new Date(date),
  );
}

function isDateInThisWeek(dateToCheck, today) {
  if (!dateToCheck) return false;
  const currentDay = today.getUTCDay();

  const firstDayOfWeek = new Date(today);
  firstDayOfWeek.setDate(today.getDate() - currentDay);
  firstDayOfWeek.setHours(0, 0, 0, 0);

  const lastDayOfWeek = new Date(firstDayOfWeek);
  lastDayOfWeek.setDate(firstDayOfWeek.getDate() + 6);
  lastDayOfWeek.setHours(23, 59, 59, 999);

  const normalizedDateToCheck = new Date(dateToCheck);
  normalizedDateToCheck.setHours(0, 0, 0, 0);

  return (
    normalizedDateToCheck >= firstDayOfWeek &&
    normalizedDateToCheck <= lastDayOfWeek
  );
}

function refreshMachineDates(config) {
  for (let i = 0; i < config.machines.length; i++) {
    config.machines[i].next_boilout = getNextBoilout(
      config.machines[i],
      config,
    );
    config.machines[i].next_filter_changes = getNextFilterChanges(
      config.machines[i],
    );
  }
}

async function load(teamId) {
  if (!teamId) throw new Error('teamId is required to load fryer config');

  await ensureWorkspaceDir(teamId);
  const file = configPath(teamId);
  let data;
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
    if (data.machines === undefined || data.time_periods === undefined) {
      throw new Error('Malformed config');
    }
  } catch (_e) {
    data = emptyConfig();
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  }

  const config = {
    time_periods: data.time_periods,
    machines: data.machines,
  };
  refreshMachineDates(config);
  configs.set(teamId, config);
  return config;
}

async function save(teamId) {
  const config = getWorkspaceConfig(teamId);
  await ensureWorkspaceDir(teamId);
  await fs.writeFile(configPath(teamId), JSON.stringify(config, null, 2));
  return true;
}

/**
 * Add fryer to machines list
 */
async function add_fryer(teamId, fryer_name, fryer_type, boilout_date) {
  const config = await load(teamId);
  const fryer = { ...MachineConfig };
  fryer.name = fryer_name;
  fryer.type = fryer_type;
  fryer.last_boilout = boilout_date;
  fryer.in_use = true;
  config.machines.push(fryer);
  refreshMachineDates(config);
  return await save(teamId);
}

/**
 * Submit a boilout and update the config
 */
async function boilout(teamId, fryer_name, date, flip_cookmode, not_inuse) {
  const config = await load(teamId);
  const machine = config.machines.find((m) => m.name === fryer_name);
  if (!machine) return false;

  if (flip_cookmode) {
    machine.type =
      machine.type === MachineType.OPEN
        ? MachineType.PRESSURE
        : MachineType.OPEN;
  }
  machine.in_use = !not_inuse;
  machine.last_boilout = date;
  machine.next_boilout = getNextBoilout(machine, config);
  machine.next_filter_changes = getNextFilterChanges(machine);

  return await save(teamId);
}

function getNextBoilout(machine, config) {
  const last_boilout = machine.last_boilout;
  return addBusinessDays(last_boilout, config.time_periods[machine.type]);
}

function getNextFilterChanges(machine) {
  const last_boilout = machine.last_boilout;
  switch (machine.type) {
    case MachineType.OPEN:
      return [addBusinessDays(last_boilout, 15)];
    case MachineType.PRESSURE:
      return [addBusinessDays(last_boilout, 10)];
    default:
      return [];
  }
}

async function getWeekSchedule(teamId, today = new Date()) {
  const config = await load(teamId);
  const week_boilouts = [];
  const week_filters = [];
  for (let i = 0; i < config.machines.length; i++) {
    const next_boilout = config.machines[i].next_boilout;
    const next_filters = config.machines[i].next_filter_changes;
    if (isDateInThisWeek(next_boilout, today)) {
      week_boilouts.push({
        machine: config.machines[i],
        date: new Date(next_boilout),
      });
    }

    const filters = next_filters.filter((m) => isDateInThisWeek(m, today));
    if (filters.length > 0) {
      week_filters.push({
        machine: config.machines[i],
        date: new Date(filters[0]),
      });
    }
  }

  return {
    filter_changes: week_filters,
    boilouts: week_boilouts,
  };
}

async function getTodayFilterChanges(
  teamId,
  referenceDate = new Date(),
  timezone = DEFAULT_TIMEZONE,
) {
  const config = await load(teamId);
  const targetDate =
    typeof referenceDate === 'string'
      ? referenceDate
      : getTodayDateString(referenceDate, timezone);
  const today_filters = [];
  for (let i = 0; i < config.machines.length; i++) {
    const machine = config.machines[i];
    if (!machine.in_use) continue;
    const next_filters = config.machines[i].next_filter_changes;
    const filters = next_filters.filter(
      (m) => toScheduleDateString(m) === targetDate,
    );
    if (filters.length > 0) {
      filters.forEach((m) => {
        today_filters.push({ machine, date: new Date(m) });
      });
    }
  }
  return today_filters;
}

async function getMonthSchedule(teamId) {
  const config = await load(teamId);
  const month_boilouts = [];
  const month_filters = [];
  const now = new Date();
  for (let i = 0; i < config.machines.length; i++) {
    const next_boilout = config.machines[i].next_boilout;
    const next_filters = config.machines[i].next_filter_changes;
    month_boilouts.push({
      machine: config.machines[i],
      date: new Date(next_boilout),
    });
    const filters = next_filters.filter(
      (m) => new Date(m).getUTCMonth() === now.getUTCMonth(),
    );
    if (filters.length > 0) {
      filters.forEach((m) => {
        month_filters.push({ machine: config.machines[i], date: new Date(m) });
      });
    }
  }
  return {
    boilouts: month_boilouts,
    filter_changes: month_filters,
  };
}

async function getConfig(teamId) {
  return await load(teamId);
}

async function migrateLegacyConfig(teamId) {
  if (!teamId) return false;
  const dest = configPath(teamId);
  const src = path.join(__dirname, 'config.json');
  try {
    await fs.access(dest);
    return false;
  } catch (_) {
    // destination does not exist yet
  }
  try {
    await fs.access(src);
  } catch (_) {
    return false;
  }
  await ensureWorkspaceDir(teamId);
  await fs.copyFile(src, dest);
  console.log(`Migrated ./config.json to ${path.relative(__dirname, dest)}`);
  return true;
}

async function migrateLegacyQuizFiles(teamId) {
  if (!teamId) return;
  await ensureWorkspaceDir(teamId);
  const pairs = [
    [
      'quiz-responses.json',
      path.join(workspaceDir(teamId), 'quiz-responses.json'),
    ],
    [
      'question-stats.json',
      path.join(workspaceDir(teamId), 'question-stats.json'),
    ],
  ];
  for (const [srcName, dest] of pairs) {
    const src = path.join(__dirname, srcName);
    try {
      await fs.access(dest);
      continue;
    } catch (_) {}
    try {
      await fs.access(src);
      await fs.copyFile(src, dest);
      console.log(`Migrated ./${srcName} to ${path.relative(__dirname, dest)}`);
    } catch (_) {}
  }
}

module.exports = {
  load,
  add_fryer,
  boilout,
  getNextBoilout,
  getMachineType,
  getMonthSchedule,
  getWeekSchedule,
  getTodayFilterChanges,
  getConfig,
  getMachineTypeString,
  toScheduleDateString,
  getTodayDateString,
  migrateLegacyConfig,
  migrateLegacyQuizFiles,
  MachineType,
};
