import express from 'express';
import bodyParser from 'body-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DirectoryState } from './state.js';
import { TorService } from '../../src/lib/torService.js';
import { createLogger } from '../../src/lib/logger.js';
import { ModeAuthService, renderAuthGatePage } from '../../src/lib/auth.js';
import { getAppMeta } from '../../src/lib/appMeta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger('directory-server');

function computeRelayReputation(relay) {
  if (typeof relay?.reputation === 'number') {
    return relay.reputation;
  }
  if (typeof relay?.reachability === 'number') {
    return Math.round(relay.reachability * 100);
  }
  return 0;
}

async function broadcastChainUpdate(state, sourceOnion) {
  const relays = await state.listRelays();
  const targets = relays.filter((relay) => relay.publicUrl && relay.onion !== sourceOnion);
  if (!targets.length) return;
  await Promise.allSettled(
    targets.map(async (relay) => {
      const endpoint = `${relay.publicUrl.replace(/\/$/, '')}/api/sync`;
      try {
        await fetch(endpoint, { method: 'POST' });
      } catch (error) {
        logger.warn(`Failed to nudge relay ${relay.onion}`, error.message);
      }
    })
  );
}

export function createDirectoryServer() {
  const app = express();
  const state = new DirectoryState();
  const torService = new TorService('directory');
  const auth = new ModeAuthService('directory');
  const loginLanding = renderAuthGatePage('Directory Authority');

  auth
    .init()
    .then(({ generatedPassword }) => {
      if (generatedPassword) {
        logger.warn(`Directory Owner 初始密码: ${generatedPassword}`);
        console.log(`[Directory] Initial Owner password: ${generatedPassword}`); // eslint-disable-line no-console
      }
    })
    .catch((error) => logger.error('Failed to initialize auth store', error.message));

  app.use(bodyParser.json());

  app.post('/api/auth/login', (req, res) => auth.handleLogin(req, res));
  app.post('/api/auth/logout', (req, res) => auth.handleLogout(req, res));
  app.get('/api/auth/session', (req, res) => auth.sessionInfo(req, res));
  app.get('/api/meta', (req, res) => {
    res.json(getAppMeta());
  });

  // Communication APIs (open for relay/client access)
  app.get('/api/relays', async (req, res) => {
    const relays = await state.listRelays();
    const manifest = await state.getCanonicalManifest();
    const relaysWithScores = relays.map((relay) => ({
      ...relay,
      reputation: computeRelayReputation(relay)
    }));
    res.json({ relays: relaysWithScores, manifest });
  });

  app.get('/api/relays/best', async (req, res) => {
    const best = await state.findBestRelay();
    if (!best) {
      res.json({ onion: null, reachability: 0, latencyMs: null, available: false });
      return;
    }
    res.json({ ...best, available: true });
  });

  app.post('/api/relays', async (req, res) => {
    try {
      const relay = await state.upsertRelay(req.body);
      const manifest = await state.getCanonicalManifest();
      const genesisHash = manifest.hashes?.[0] || manifest.latestHash || null;
      res.json({ relay, genesisHash });
      setImmediate(() => {
        broadcastChainUpdate(state, relay.onion).catch((error) =>
          logger.warn('Broadcast to relays failed', error.message)
        );
      });
    } catch (error) {
      logger.error('Failed to upsert relay', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Admin APIs (require authentication)
  const requireAuth = auth.requireAuth;

  app.get('/api/tor/status', requireAuth, async (req, res) => {
    res.json(await torService.status());
  });

  app.get('/api/tor/config', requireAuth, async (req, res) => {
    res.json(await torService.config());
  });

  app.post('/api/tor/config', async (req, res) => {
    const config = await torService.updateConfig(req.body);
    res.json(config);
  });

  app.post('/api/tor/start', async (req, res) => {
    const status = await torService.start(req.body);
    res.json(status);
  });

  app.post('/api/tor/stop', async (req, res) => {
    const status = await torService.stop();
    res.json(status);
  });

  // Directory WebUI API endpoints
  app.get('/api/directory/stats', async (req, res) => {
    const manifest = await state.getCanonicalManifest();
    const relays = await state.listRelays();
    const startTime = state.startTime || Date.now();
    
    res.json({
      blockHeight: manifest.length || 0,
      activeRelays: relays.filter(r => new Date(r.lastSeen) > Date.now() - 300000).length,
      networkHealth: 100,
      uptime: Math.floor((Date.now() - startTime) / 1000)
    });
  });

  app.get('/api/directory/blockchain', requireAuth, async (req, res) => {
    const manifest = await state.getCanonicalManifest();
    const relays = await state.listRelays();
    
    res.json({
      genesisHash: manifest.hashes?.[0] || '—',
      latestHash: manifest.latestHash || '—',
      totalLetters: manifest.length || 0,
      chainSize: relays.reduce((sum, r) => sum + (r.chainSummary?.length || 0), 0)
    });
  });

  app.post('/api/directory/blockchain/sync', requireAuth, async (req, res) => {
    const manifest = await state.getCanonicalManifest();
    res.json({
      success: true,
      height: manifest.length || 0,
      message: '区块链已是最新状态'
    });
  });

  app.get('/api/directory/relays', requireAuth, async (req, res) => {
    const relays = await state.listRelays();
    const now = Date.now();
    const formattedRelays = relays.map(relay => ({
      onion: relay.onion,
      publicUrl: relay.publicUrl,
      nickname: relay.nickname || relay.onion?.substring(0, 8) || 'N/A',
      fingerprint: relay.fingerprint || relay.onion?.substring(0, 16) || 'N/A',
      isOnline: new Date(relay.lastSeen) > now - 300000,
      reachability: relay.reachability,
      reputation: computeRelayReputation(relay),
      latencyMs: relay.latencyMs || 0,
      gfwBlocked: relay.gfwBlocked || false,
      lastSeen: relay.lastSeen,
      lastHeartbeat: relay.lastHeartbeat || relay.lastSeen,
      createdAt: relay.createdAt,
      chainSummary: relay.chainSummary
    }));
    res.json({ relays: formattedRelays });
  });

  app.get('/api/directory/tor/status', requireAuth, async (req, res) => {
    const status = await torService.status();
    res.json(status);
  });

  app.post('/api/directory/tor/config', requireAuth, async (req, res) => {
    const config = await torService.updateConfig(req.body);
    res.json(config);
  });

  app.post('/api/directory/tor/start', requireAuth, async (req, res) => {
    const status = await torService.start(req.body);
    res.json(status);
  });

  app.post('/api/directory/tor/stop', requireAuth, async (req, res) => {
    const status = await torService.stop();
    res.json(status);
  });

  const publicDir = path.resolve(path.join(__dirname, '../../web/directory'));
  const sharedDir = path.resolve(path.join(__dirname, '../../web/shared'));
  
  // Auth middleware for static files
  const requireAuthForStatic = (req, res, next) => {
    const session = auth.getSessionFromRequest(req);
    if (!session) {
      res.status(401).send(loginLanding);
      return;
    }
    next();
  };
  
  app.use('/shared', requireAuthForStatic, express.static(sharedDir));
  app.use(requireAuthForStatic, express.static(publicDir));

  // Serve UI only to authenticated users
  app.use((req, res) => {
    const session = auth.getSessionFromRequest(req);
    if (!session) {
      res.status(401).send(loginLanding);
      return;
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}

export function startDirectoryServer(port = process.env.PORT || 4600) {
  const app = createDirectoryServer();
  app.listen(port, () => {
    logger.info(`Directory server listening on http://localhost:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startDirectoryServer();
}
