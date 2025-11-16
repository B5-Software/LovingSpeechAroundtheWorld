#!/usr/bin/env node
import { Command } from 'commander';
import { startDirectoryServer } from '../modes/directory/server.js';
import { DirectoryState } from '../modes/directory/state.js';
import { startRelayServer } from '../modes/relay/server.js';
import { RelayState } from '../modes/relay/state.js';
import { startClientServer } from '../modes/client/server.js';
import { ClientState } from '../modes/client/state.js';
import { TorService } from '../src/lib/torService.js';
import { ModeAuthService, generateRandomPassword } from '../src/lib/auth.js';

const program = new Command();
program.name('loving-speech').description('Loving Speech Around the World CLI');

// Directory commands
const directory = program.command('directory').description('Directory authority actions');
directory
  .command('serve')
  .description('Start the directory web server')
  .option('-p, --port <port>', 'Port to listen on', '4600')
  .action((opts) => {
    startDirectoryServer(Number(opts.port));
  });

directory
  .command('relays:list')
  .description('List registered relays')
  .action(async () => {
    const state = new DirectoryState();
    const relays = await state.listRelays();
    console.table(relays.map((relay) => ({ onion: relay.onion, latency: relay.latencyMs, length: relay.chainSummary?.length }))); // eslint-disable-line no-console
  });

directory
  .command('relays:best')
  .description('Show best relay choice')
  .action(async () => {
    const state = new DirectoryState();
    const best = await state.findBestRelay();
    console.log(best); // eslint-disable-line no-console
  });

directory
  .command('tor:start')
  .description('Start Tor for directory mode')
  .action(async () => {
    const tor = new TorService('directory');
    const status = await tor.start();
    console.log(status); // eslint-disable-line no-console
  });

directory
  .command('tor:status')
  .description('Show Tor status for directory mode')
  .action(async () => {
    const tor = new TorService('directory');
    console.log(await tor.status()); // eslint-disable-line no-console
  });

directory
  .command('tor:stop')
  .description('Stop Tor for directory mode')
  .action(async () => {
    const tor = new TorService('directory');
    console.log(await tor.stop()); // eslint-disable-line no-console
  });

directory
  .command('tor:config')
  .description('Update Tor configuration for directory mode')
  .option('--path <torPath>', 'Tor executable path')
  .option('--socks <port>', 'SOCKS port')
  .option('--control <port>', 'Control port')
  .option('--bridge <bridge...>', 'Add bridge entries')
  .action(async (opts) => {
    const tor = new TorService('directory');
    const payload = {};
    if (opts.path) payload.torPath = opts.path;
    if (opts.socks) payload.socksPort = Number(opts.socks);
    if (opts.control) payload.controlPort = Number(opts.control);
    if (opts.bridge) payload.bridges = opts.bridge;
    console.log(await tor.updateConfig(payload)); // eslint-disable-line no-console
  });

directory
  .command('auth:reset')
  .description('Reset directory Owner password (prints the new password)')
  .option('-p, --password <password>', 'Provide explicit password, otherwise auto-generate')
  .action(async (opts) => {
    const auth = new ModeAuthService('directory');
    await auth.init();
    const password = opts.password || generateRandomPassword();
    await auth.setOwnerPassword(password);
    console.log(`[Directory] Owner password updated: ${password}`); // eslint-disable-line no-console
  });

// Relay commands
const relay = program.command('relay').description('Relay node operations');
relay
  .command('serve')
  .description('Start the relay web server')
  .option('-p, --port <port>', 'Port to listen on', '4700')
  .action((opts) => startRelayServer(Number(opts.port)));

relay
  .command('status')
  .description('Show relay summary')
  .action(async () => {
    const state = new RelayState();
    await state.init();
    console.log(await state.getSummary()); // eslint-disable-line no-console
  });

relay
  .command('report')
  .description('Report relay status to directory')
  .action(async () => {
    const state = new RelayState();
    await state.init();
    console.log(await state.reportToDirectory('cli')); // eslint-disable-line no-console
  });

relay
  .command('config:get')
  .description('Show relay configuration')
  .action(async () => {
    const state = new RelayState();
    await state.init();
    console.log(await state.config.get()); // eslint-disable-line no-console
  });

relay
  .command('config:set')
  .description('Update relay configuration')
  .option('--directory <url>', 'Directory server URL')
  .option('--onion <onion>', 'Relay onion address')
  .option('--public <url>', 'Public HTTP URL')
  .option('--public-access <url>', 'External access URL shared with directory/clients')
  .option('--latency <ms>', 'Latency in milliseconds')
  .option('--reachability <ratio>', 'Reachability score 0-1')
  .option('--gfw <flag>', 'Whether blocked by GFW')
  .action(async (opts) => {
    const state = new RelayState();
    await state.init();
    const payload = {};
    if (opts.directory) payload.directoryUrl = opts.directory;
    if (opts.onion) payload.onion = opts.onion;
    if (opts.public) payload.publicUrl = opts.public;
    if (opts.publicAccess !== undefined) {
      const sanitizedAccessUrl = opts.publicAccess.trim();
      payload.publicAccessUrl = sanitizedAccessUrl;
      if (sanitizedAccessUrl) {
        payload.publicUrl = sanitizedAccessUrl;
      }
    }
    if (!payload.metrics) payload.metrics = (await state.config.get()).metrics || {};
    if (opts.latency) payload.metrics.latencyMs = Number(opts.latency);
    if (opts.reachability) payload.metrics.reachability = Number(opts.reachability);
    if (opts.gfw !== undefined) payload.metrics.gfwBlocked = opts.gfw === 'true';
    console.log(await state.config.update(payload)); // eslint-disable-line no-console
  });

relay
  .command('sync')
  .description('Sync blocks from best relay in directory')
  .action(async () => {
    const state = new RelayState();
    await state.init();
    console.log(await state.syncFromDirectory()); // eslint-disable-line no-console
  });

relay
  .command('tor:start')
  .description('Start Tor for relay mode')
  .action(async () => {
    const tor = new TorService('relay');
    console.log(await tor.start()); // eslint-disable-line no-console
  });

relay
  .command('tor:status')
  .description('Show Tor status for relay mode')
  .action(async () => {
    const tor = new TorService('relay');
    console.log(await tor.status()); // eslint-disable-line no-console
  });

relay
  .command('tor:stop')
  .description('Stop Tor for relay mode')
  .action(async () => {
    const tor = new TorService('relay');
    console.log(await tor.stop()); // eslint-disable-line no-console
  });

relay
  .command('tor:config')
  .description('Update Tor configuration for relay mode')
  .option('--path <torPath>', 'Tor executable path')
  .option('--socks <port>', 'SOCKS port')
  .option('--control <port>', 'Control port')
  .option('--bridge <bridge...>', 'Bridge entries')
  .action(async (opts) => {
    const tor = new TorService('relay');
    const payload = {};
    if (opts.path) payload.torPath = opts.path;
    if (opts.socks) payload.socksPort = Number(opts.socks);
    if (opts.control) payload.controlPort = Number(opts.control);
    if (opts.bridge) payload.bridges = opts.bridge;
    console.log(await tor.updateConfig(payload)); // eslint-disable-line no-console
  });

relay
  .command('auth:reset')
  .description('Reset relay Owner password (prints the new password)')
  .option('-p, --password <password>', 'Provide explicit password, otherwise auto-generate')
  .action(async (opts) => {
    const auth = new ModeAuthService('relay');
    await auth.init();
    const password = opts.password || generateRandomPassword();
    await auth.setOwnerPassword(password);
    console.log(`[Relay] Owner password updated: ${password}`); // eslint-disable-line no-console
  });

// Client commands
const client = program.command('client').description('Client actions');
client
  .command('serve')
  .description('Start the client web UI')
  .option('-p, --port <port>', 'Port to listen on', '4800')
  .action((opts) => startClientServer(Number(opts.port)));

client
  .command('keys:list')
  .description('List stored keys')
  .action(async () => {
    const state = new ClientState();
    await state.init();
    console.table(await state.listKeys()); // eslint-disable-line no-console
  });

client
  .command('keys:create')
  .description('Create a new key pair')
  .option('-l, --label <label>', 'Label for key')
  .action(async (opts) => {
    const state = new ClientState();
    await state.init();
    console.log(await state.createKey(opts.label)); // eslint-disable-line no-console
  });

client
  .command('letter:send')
  .description('Compose a letter and upload to relay')
  .requiredOption('-k, --key <keyId>', 'Key identifier')
  .requiredOption('-t, --text <text>', 'Letter content')
  .option('-r, --relay <url>', 'Relay override URL')
  .action(async (opts) => {
    const state = new ClientState();
    await state.init();
    console.log(
      await state.composeLetter({ keyId: opts.key, text: opts.text, metadata: { title: 'CLI letter' }, relayUrl: opts.relay })
    ); // eslint-disable-line no-console
  });

client
  .command('letters:list')
  .description('Decrypt synced letters for a key')
  .requiredOption('-k, --key <keyId>', 'Key identifier')
  .action(async (opts) => {
    const state = new ClientState();
    await state.init();
    console.log(await state.findLetters(opts.key)); // eslint-disable-line no-console
  });

client
  .command('config:get')
  .description('Show client connectivity config')
  .action(async () => {
    const state = new ClientState();
    await state.init();
    console.log(await state.config.get()); // eslint-disable-line no-console
  });

client
  .command('config:set')
  .description('Update directory/preferred relay URLs')
  .option('--directory <url>', 'Directory server URL')
  .option('--relay <url>', 'Preferred relay URL')
  .action(async (opts) => {
    const state = new ClientState();
    await state.init();
    const payload = {};
    if (opts.directory) payload.directoryUrl = opts.directory;
    if (opts.relay) payload.preferredRelay = opts.relay;
    console.log(await state.updateConfig(payload)); // eslint-disable-line no-console
  });

client
  .command('sync')
  .description('Sync local blocks from relay')
  .action(async () => {
    const state = new ClientState();
    await state.init();
    console.log(await state.syncBlocks()); // eslint-disable-line no-console
  });

client
  .command('tor:start')
  .description('Start Tor for client mode')
  .action(async () => {
    const tor = new TorService('client');
    console.log(await tor.start()); // eslint-disable-line no-console
  });

client
  .command('tor:status')
  .description('Show Tor status for client mode')
  .action(async () => {
    const tor = new TorService('client');
    console.log(await tor.status()); // eslint-disable-line no-console
  });

client
  .command('tor:stop')
  .description('Stop Tor for client mode')
  .action(async () => {
    const tor = new TorService('client');
    console.log(await tor.stop()); // eslint-disable-line no-console
  });

client
  .command('tor:config')
  .description('Update Tor config for client mode')
  .option('--path <torPath>', 'Tor executable path')
  .option('--socks <port>', 'SOCKS port')
  .option('--control <port>', 'Control port')
  .option('--bridge <bridge...>', 'Bridge entries')
  .action(async (opts) => {
    const tor = new TorService('client');
    const payload = {};
    if (opts.path) payload.torPath = opts.path;
    if (opts.socks) payload.socksPort = Number(opts.socks);
    if (opts.control) payload.controlPort = Number(opts.control);
    if (opts.bridge) payload.bridges = opts.bridge;
    console.log(await tor.updateConfig(payload)); // eslint-disable-line no-console
  });

program.parseAsync();
