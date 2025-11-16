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
const METRICS_POLL_INTERVAL_MS = Number(process.env.DIRECTORY_METRICS_INTERVAL_MS ?? 180000);
const RELAY_PROBE_TIMEOUT_MS = Number(process.env.DIRECTORY_METRICS_TIMEOUT_MS ?? 8000);

function sanitizeIp(raw) {
  if (!raw) return null;
  let value = raw.trim();
  if (value.startsWith('::ffff:')) {
    value = value.slice(7);
  }
  value = value.replace(/^\[(.*)]$/, '$1');
  value = value.replace(/%.*$/, '');
  value = value.replace(/:\d+$/, '');
  if (value === '::1') {
    return '127.0.0.1';
  }
  return value;
}

function captureClientNetwork(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedChain = typeof forwarded === 'string'
    ? forwarded.split(',').map((entry) => sanitizeIp(entry)).filter(Boolean)
    : [];
  const forwardedIp = forwardedChain[0] || null;
  const socketAddr = sanitizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress);
  const clientAddress = sanitizeIp(forwardedIp || socketAddr);
  return {
    clientAddress,
    clientHost: clientAddress?.replace(/^\[(.*)]$/, '$1') || null,
    forwardedChain,
    rawRemoteAddress: socketAddr
  };
}

function parseUrlFlexible(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return new URL(value);
  } catch (err) {
    try {
      return new URL(`https://${value.replace(/^\/*/, '')}`);
    } catch (innerErr) {
      return null;
    }
  }
}

function isLoopbackHost(hostname) {
  if (!hostname) return false;
  const normalized = hostname.replace(/^\[(.*)]$/, '$1').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function resolveRelayPublicUrl(reportedUrl, clientHost) {
  const parsed = parseUrlFlexible(reportedUrl);
  if (!parsed) {
    return reportedUrl || null;
  }
  if (isLoopbackHost(parsed.hostname) && clientHost) {
    parsed.hostname = clientHost;
  }
  return parsed.toString().replace(/\/$/, '');
}

function isLikelyGfwError(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return true;
  const suspectedCodes = ['ECONNRESET', 'ENETRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ETIMEDOUT'];
  if (error.code && suspectedCodes.includes(error.code)) {
    return true;
  }
  const message = error.message || '';
  return /(connection reset|read ECONNRESET|ETIMEDOUT|ENETRESET)/i.test(message);
}

async function probeRelayMetrics(state, relay) {
  if (!relay?.publicUrl) return null;
  const endpoint = `${relay.publicUrl.replace(/\/$/, '')}/api/status`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELAY_PROBE_TIMEOUT_MS);
  const started = Date.now();
  const metrics = { metricsSource: 'directory-probe' };
  try {
    const response = await fetch(endpoint, { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      metrics.latencyMs = null;
      metrics.reachability = 0;
      metrics.gfwBlocked = response.status === 403;
      metrics.metricsError = `HTTP_${response.status}`;
    } else {
      metrics.latencyMs = Date.now() - started;
      metrics.reachability = 1;
      metrics.gfwBlocked = false;
      metrics.metricsError = null;
      try {
        await response.arrayBuffer();
      } catch (consumeErr) {
        logger.debug('Failed to consume relay status response', consumeErr.message);
      }
    }
  } catch (error) {
    clearTimeout(timeout);
    metrics.latencyMs = null;
    metrics.reachability = 0;
    metrics.gfwBlocked = isLikelyGfwError(error);
    metrics.metricsError = error.message;
    metrics.metricsNotes = metrics.gfwBlocked ? 'Probe blocked/reset' : 'Probe failed';
  }
  metrics.metricsSampledAt = new Date().toISOString();
  await state.updateRelayMetrics(relay.onion, metrics);
  return metrics;
}

function startRelayMetricsPoller(state) {
  const interval = Number.isFinite(METRICS_POLL_INTERVAL_MS) && METRICS_POLL_INTERVAL_MS > 0
    ? METRICS_POLL_INTERVAL_MS
    : 180000;

  const runPoll = async () => {
    try {
      const relays = await state.listRelays();
      if (!relays.length) {
        return;
      }
      await Promise.allSettled(
        relays
          .filter((relay) => relay.publicUrl)
          .map((relay) => probeRelayMetrics(state, relay).catch((error) => {
            logger.debug('Relay probe failed', relay.onion, error.message);
          }))
      );
    } catch (error) {
      logger.warn('Relay metrics poll failed', error.message);
    }
  };

  runPoll().catch((error) => logger.warn('Initial relay metrics poll failed', error.message));
  const timer = setInterval(() => {
    runPoll().catch((error) => logger.debug('Relay metrics poll iteration failed', error.message));
  }, interval);
  timer.unref?.();
}

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
  const bootStartedAt = Date.now();
  startRelayMetricsPoller(state);

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
      const network = captureClientNetwork(req);
      const resolvedPublicUrl = resolveRelayPublicUrl(req.body?.publicUrl, network.clientHost);
      const relayPayload = {
        ...req.body,
        publicUrl: resolvedPublicUrl || req.body?.publicUrl || null,
        lastSeenIp: network.clientAddress,
        connectionMeta: {
          reportedPublicUrl: req.body?.publicUrl || null,
          resolvedPublicUrl: resolvedPublicUrl || req.body?.publicUrl || null,
          clientAddress: network.clientAddress,
          forwardedChain: network.forwardedChain,
          rawRemoteAddress: network.rawRemoteAddress,
          resolvedAt: new Date().toISOString()
        }
      };
      const relay = await state.upsertRelay(relayPayload);
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
    const now = Date.now();
    const recentThreshold = now - 5 * 60 * 1000;
    const reachabilitySamples = relays
      .map((relay) => Number(relay.reachability ?? 0))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const averageReachability = reachabilitySamples.length
      ? reachabilitySamples.reduce((sum, value) => sum + value, 0) / reachabilitySamples.length
      : 0;
    const latencies = relays
      .map((relay) => Number(relay.latencyMs))
      .filter((value) => Number.isFinite(value) && value > 0);
    const avgLatency = latencies.length
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : null;
    const activeRelays = relays.filter((relay) => {
      if ((relay.reachability ?? 0) >= 0.5) return true;
      const seenAt = relay.lastSeen ? new Date(relay.lastSeen).getTime() : 0;
      return seenAt > recentThreshold;
    }).length;

    res.json({
      blockHeight: manifest.length || 0,
      activeRelays,
      networkHealth: Math.max(0, Math.min(100, Math.round(averageReachability * 100))),
      uptime: Math.floor((now - bootStartedAt) / 1000),
      sampledRelays: reachabilitySamples.length,
      averageLatencyMs: avgLatency
    });
  });

  app.get('/api/directory/blockchain', requireAuth, async (req, res) => {
    const manifest = await state.getCanonicalManifest();
    const relays = await state.listRelays();
    const chainHeight = manifest.length || 0;
    const totalLetters = chainHeight > 0 ? chainHeight - 1 : 0;
    
    res.json({
      genesisHash: manifest.hashes?.[0] || '—',
      latestHash: manifest.latestHash || '—',
      totalLetters,
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
    const formattedRelays = relays.map((relay) => ({
      onion: relay.onion,
      publicUrl: relay.publicUrl,
      resolvedPublicUrl: relay.connectionMeta?.resolvedPublicUrl || relay.publicUrl || null,
      reportedPublicUrl: relay.connectionMeta?.reportedPublicUrl || relay.publicUrl || null,
      nickname: relay.nickname || relay.onion?.substring(0, 8) || 'N/A',
      fingerprint: relay.fingerprint || relay.onion?.substring(0, 16) || 'N/A',
      isOnline: new Date(relay.lastSeen) > now - 300000 || (relay.reachability ?? 0) >= 0.5,
      reachability: relay.reachability,
      reputation: computeRelayReputation(relay),
      latencyMs: relay.latencyMs ?? null,
      gfwBlocked: relay.gfwBlocked || false,
      lastSeen: relay.lastSeen,
      lastHeartbeat: relay.lastHeartbeat || relay.lastSeen,
      createdAt: relay.createdAt,
      chainSummary: relay.chainSummary,
      lastSeenIp: relay.lastSeenIp || relay.connectionMeta?.clientAddress || null,
      connectionMeta: relay.connectionMeta || null,
      metricsSampledAt: relay.metricsSampledAt || null,
      metricsSource: relay.metricsSource || null,
      metricsError: relay.metricsError || null,
      metricsNotes: relay.metricsNotes || null
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
