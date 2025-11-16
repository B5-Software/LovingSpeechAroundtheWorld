const path = require('node:path');

const cwd = __dirname;
const baseScript = path.join('scripts', 'start.js');

function buildApp(name, env) {
  return {
    name,
    script: baseScript,
    cwd,
    interpreter: 'node',
    env: {
      NODE_ENV: 'production',
      ...env
    }
  };
}

module.exports = {
  apps: [
    buildApp('lovingspeech-directory', {
      APP_MODE: 'directory',
      DIRECTORY_PORT: 4600
    }),
    buildApp('lovingspeech-relay', {
      APP_MODE: 'relay',
      RELAY_PORT: 4700
    }),
    buildApp('lovingspeech-client', {
      APP_MODE: 'client',
      CLIENT_PORT: 4800
    }),
    buildApp('lovingspeech-relay-client', {
      APP_MODE: 'relay-client',
      RELAY_PORT: 4700,
      CLIENT_PORT: 4800
    }),
    buildApp('lovingspeech-full-stack', {
      APP_MODE: 'directory-relay-client',
      DIRECTORY_PORT: 4600,
      RELAY_PORT: 4700,
      CLIENT_PORT: 4800
    })
  ]
};
