const path = require('node:path');

const cwd = __dirname;

module.exports = {
  apps: [
    {
      name: 'lovingspeech-relay',
      script: path.join('scripts', 'start.js'),
      cwd,
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        APP_MODE: 'relay',
        RELAY_PORT: 4710
      }
    },
    {
      name: 'lovingspeech-full-stack',
      script: path.join('scripts', 'start.js'),
      cwd,
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        APP_MODE: 'directory-relay-client',
        DIRECTORY_PORT: 4600,
        RELAY_PORT: 4700,
        CLIENT_PORT: 4800
      }
    }
  ]
};
