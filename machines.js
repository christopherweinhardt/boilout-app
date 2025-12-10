import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs/promises');

const MachineType = {
    OPEN: 0,
    PRESSURE: 1,
    POTATO: 2
}

const MachineConfig = {
    name: "",
    type: MachineType.OPEN,
    last_boilout: new Date(),
    next_boilout: new Date(),
    next_filter_changes: [],
    in_use: true
}

const GeneralConfig = {
    machines: [],
    time_periods: {
        0: 36,
        1: 30,
        2: 15
    }
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
            return "Open";
        case MachineType.PRESSURE:
            return "Pressure";
        case MachineType.POTATO:
            return "Potato";
        default:
            return "";
    }
}


// Robust helper — accepts Date | string | number and supports negative days
function addBusinessDays(dateLike, days) {
    const date = new Date(dateLike);           // handles Date, string, number
    if (isNaN(date)) throw new TypeError('Invalid date input');

    const result = new Date(date.valueOf());
    const step = days >= 0 ? 1 : -1;
    let remaining = Math.abs(days);

    while (remaining > 0) {
        result.setDate(result.getDate() + step);
        // skip Sundays (0)
        if (result.getUTCDay() !== 0) {
            remaining--;
        }
    }

    // if result is a sunday, add 1 day
    if (result.getUTCDay() === 0) {
        result.setDate(result.getDate() + 1);
    }
    return result;
}

function isDateInThisWeek(dateToCheck, today) {
    if (!dateToCheck)
        return false;
    const currentDay = today.getUTCDay(); // 0 for Sunday, 1 for Monday, ..., 6 for Saturday

    // Calculate the start of the current week (Sunday)
    const firstDayOfWeek = new Date(today);
    firstDayOfWeek.setDate(today.getDate() - currentDay);
    firstDayOfWeek.setHours(0, 0, 0, 0); // Set to the beginning of the day

    // Calculate the end of the current week (Saturday)
    const lastDayOfWeek = new Date(firstDayOfWeek);
    lastDayOfWeek.setDate(firstDayOfWeek.getDate() + 6);
    lastDayOfWeek.setHours(23, 59, 59, 999); // Set to the end of the day

    // Ensure the dateToCheck is also normalized to avoid time discrepancies
    const normalizedDateToCheck = new Date(dateToCheck);
    normalizedDateToCheck.setHours(0, 0, 0, 0);

    return normalizedDateToCheck >= firstDayOfWeek && normalizedDateToCheck <= lastDayOfWeek;
}

/**
 *  Config Handling
 */

let config = { ...GeneralConfig };

var retry_count = 0;
async function load() {
    Date.prototype.addDays = function (days) {
        var date = new Date(this.valueOf());
        date.setDate(date.getDate() + days);
        return date;
    }
    Date.prototype.addBusinessDays = function (days) {
        const result = new Date(this.valueOf());
        let added = 0;

        while (added < days) {
            result.setDate(result.getDate() + 1);

            // getUTCDay() → 0=Sunday, 6=Saturday
            if (result.getUTCDay() !== 0) {
                added++;
            }
        }
        return result;
    };
    retry_count = 0;
    try {
        let data = JSON.parse(await fs.readFile("./config.json", 'utf-8'));
        if (data.machines == undefined || data.time_periods == undefined)
            throw new Error("Malformed config");
        config.machines = data.machines;
        for (var i = 0; i < config.machines.length; i++) {
            config.machines[i].next_boilout = getNextBoilout(config.machines[i]);
            config.machines[i].next_filter_changes = getNextFilterChanges(config.machines[i]);
        }
        config.time_periods = data.time_periods;
    } catch (e) {
        console.log(e);
        if (retry_count >= 3)
            return;
        await fs.writeFile('./config.json', JSON.stringify(GeneralConfig, null, 2));
        load();
        retry_count++;
    }
}

async function save() {
    retry_count = 0;
    try {
        await fs.writeFile('./config.json', JSON.stringify(config, null, 2));
        return true;
    } catch (e) {
        console.log(e);
        if (retry_count >= 3)
            return false;
        save();
        retry_count++;
    }
}

/**
 * Add fryer to machines list
 * @param {string} fryer_name 
 * @param {MachineType} fryer_type 
 * @param {Date} boilout_date 
 */
async function add_fryer(fryer_name, fryer_type, boilout_date) {
    let fryer = { ...MachineConfig }
    fryer.name = fryer_name;
    fryer.type = fryer_type;
    fryer.last_boilout = boilout_date;
    fryer.in_use = true;
    config.machines.push(fryer);

    return await save();
}

/**
 * Submit a boilout and update the config
 * @param {string} fryer_name 
 * @param {Date} date 
 * @param {boolean} flip_cookmode 
 * @param {boolean} not_inuse 
 * @returns 
 */
async function boilout(fryer_name, date, flip_cookmode, not_inuse) {
    let machine = config.machines.find(m => m.name == fryer_name);
    if (!machine)
        return false;

    if (flip_cookmode) {
        machine.type = (machine.type == MachineType.OPEN) ? MachineType.PRESSURE : MachineType.OPEN;
    }
    machine.in_use = !not_inuse;

    machine.last_boilout = date;
    machine.next_boilout = getNextBoilout(machine);
    machine.next_filter_changes = getNextFilterChanges(machine);

    return await save();
}


/**
 * 
 * @param {MachineConfig} machine 
 */
function getNextBoilout(machine) {
    const last_boilout = machine.last_boilout;
    const next_boilout = addBusinessDays(last_boilout, config.time_periods[machine.type]);
    return next_boilout;
}

/**
 * 
 * @param {MachineConfig} machine 
 */
function getNextFilterChanges(machine) {
    const last_boilout = machine.last_boilout;
    switch (machine.type) {
        case MachineType.OPEN:
            return [addBusinessDays(last_boilout, 15)]
        case MachineType.PRESSURE:
            return [addBusinessDays(last_boilout, 10)]//, addBusinessDays(last_boilout, 20)]
        default:
            return [];
    }
}


const Schedule = {
    boilouts: [],
    filter_changes: []
};

/**
 * 
 * @returns {Schedule} machines
 */
async function getWeekSchedule(today = new Date()) {
    let week_boilouts = [];
    let week_filters = [];
    for (var i = 0; i < config.machines.length; i++) {
        const next_boilout = config.machines[i].next_boilout;
        const next_filters = config.machines[i].next_filter_changes;
        if (isDateInThisWeek(next_boilout, today))
            week_boilouts.push({ machine: config.machines[i], date: new Date(next_boilout) });

        let filters = next_filters.filter(m => isDateInThisWeek(m, today));
        if (filters.length > 0) {
            week_filters.push({ machine: config.machines[i], date: new Date(filters[0]) });
        }
    }

    return {
        filter_changes: week_filters,
        boilouts: week_boilouts
    };
}

/**
 * 
 * @returns {Schedule} machines
 */
async function getMonthSchedule() {
    // loop through machines
    let month_boilouts = [];
    let month_filters = [];
    for (var i = 0; i < config.machines.length; i++) {
        const next_boilout = config.machines[i].next_boilout;
        const next_filters = config.machines[i].next_filter_changes;
        const now = new Date();
        month_boilouts.push({ machine: config.machines[i], date: new Date(next_boilout) });
        let filters = next_filters.filter(m => new Date(m).getMonth() == now.getMonth());
        if (filters.length > 0) {
            filters.forEach(m => {
                month_filters.push({ machine: config.machines[i], date: new Date(m) });
            })
        }
    }
    return {
        boilouts: month_boilouts,
        filter_changes: month_filters
    };
}

async function getConfig() {
    return config;
}

export { load, add_fryer, boilout, getNextBoilout, getMachineType, getMonthSchedule, getWeekSchedule, getConfig, getMachineTypeString }