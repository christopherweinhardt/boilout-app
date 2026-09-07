const fs = require('node:fs');
const { FileInstallationStore } = require('@slack/oauth');

function createInstallationStore(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  return new FileInstallationStore({
    baseDir,
    historicalDataEnabled: false,
  });
}

function installationQuery(workspaceId, enterpriseId) {
  if (workspaceId?.startsWith('E') && !enterpriseId) {
    return { enterpriseId: workspaceId, isEnterpriseInstall: true };
  }
  const query = { teamId: workspaceId, isEnterpriseInstall: false };
  if (enterpriseId) query.enterpriseId = enterpriseId;
  return query;
}

async function listInstallationQueries(baseDir, workspaceId) {
  const queries = [installationQuery(workspaceId)];
  let entries;
  try {
    entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return queries;
    throw err;
  }

  const suffix = `-${workspaceId}`;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(suffix)) continue;
    const enterpriseId = entry.name.slice(0, -suffix.length);
    if (enterpriseId) {
      queries.push(installationQuery(workspaceId, enterpriseId));
    }
  }
  return queries;
}

async function fetchBotToken(installationStore, baseDir, workspaceId) {
  if (!workspaceId) {
    throw new Error('workspaceId is required to fetch a bot token');
  }

  const queries = await listInstallationQueries(baseDir, workspaceId);
  let lastError;
  for (const query of queries) {
    try {
      const installation = await installationStore.fetchInstallation(query);
      const token = installation?.bot?.token;
      if (token) return token;
    } catch (err) {
      lastError = err;
    }
  }

  throw (
    lastError ||
    new Error(`No installation data found for workspace ${workspaceId}`)
  );
}

module.exports = {
  createInstallationStore,
  fetchBotToken,
};
