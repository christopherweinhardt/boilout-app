const fs = require('node:fs');
const { FileInstallationStore } = require('@slack/oauth');

function createInstallationStore(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  return new FileInstallationStore({
    baseDir,
    historicalDataEnabled: false,
  });
}

module.exports = {
  createInstallationStore,
};
