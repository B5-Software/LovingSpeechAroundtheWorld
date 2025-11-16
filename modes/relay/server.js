import express from 'express';
import bodyParser from 'body-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RelayState } from './state.js';
import { TorService } from '../../src/lib/torService.js';
import { createLogger } from '../../src/lib/logger.js';
import { ModeAuthService, renderAuthGatePage } from '../../src/lib/auth.js';
import { getAppMeta } from '../../src/lib/appMeta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger('relay-server');

export function createRelayServer() {
  const app = express();
  const state = new RelayState();
  const torService = new TorService('relay');
  const ready = state.init();
  const auth = new ModeAuthService('relay');
  const loginLanding = renderAuthGatePage('Relay Console');
  auth
    .init()
    .then(({ generatedPassword }) => {
      if (generatedPassword) {
        logger.warn(`Relay Owner 初始密码: ${generatedPassword}`);
        console.log(`[Relay] Initial Owner password: ${generatedPassword}`); // eslint-disable-line no-console
      }
    })
    .catch((error) => logger.error('Failed to initialize relay auth store', error.message));

  const envSyncIntervalMs = Number(process.env.RELAY_SYNC_INTERVAL_MS ?? 60000);
  const envReportIntervalMs = Number(process.env.RELAY_REPORT_INTERVAL_MS ?? 120000);

  ready
    .then(async () => {
      logger.info('Relay state initialized, starting automation loops');
      const configSnapshot = await state.config.get();
      const configuredHeartbeatMs = Number(configSnapshot.heartbeatInterval ?? 0) * 1000;
      const reportIntervalMs = Number.isFinite(envReportIntervalMs) && envReportIntervalMs > 0
        ? envReportIntervalMs
        : configuredHeartbeatMs > 0
          ? configuredHeartbeatMs
          : 120000;
      const syncIntervalMs = envSyncIntervalMs > 0 ? envSyncIntervalMs : 60000;

      logger.info('Automation intervals configured', {
        syncIntervalMs,
        reportIntervalMs,
        configuredHeartbeatMs,
        envReportIntervalMs,
        envSyncIntervalMs
      });

      try {
        const startupReport = await state.reportToDirectory('startup');
        if (startupReport?.delivered) {
          logger.info('Startup heartbeat delivered to directory', startupReport);
        } else {
          logger.warn('Startup heartbeat skipped or failed', startupReport);
        }
      } catch (error) {
        logger.warn('Startup heartbeat threw error', error.message);
      }

      const syncTimer = setInterval(async () => {
        try {
          const result = await state.syncFromDirectory();
          if (result?.updated) {
            logger.info('Auto sync pulled new chain snapshot', result);
          }
        } catch (error) {
          logger.warn('Auto sync failed', error.message);
        }
      }, syncIntervalMs);
      syncTimer.unref?.();

      const reportTimer = setInterval(() => {
        state
          .reportToDirectory('auto-interval')
          .then((result) => {
            if (result?.delivered) {
              logger.debug('Auto report delivered to directory');
            }
          })
          .catch((error) => logger.warn('Auto directory report failed', error.message));
      }, reportIntervalMs);
      reportTimer.unref?.();
    })
    .catch((error) => {
      logger.error('Relay initialization failed', error.message);
    });

  app.use(bodyParser.json({ limit: '2mb' }));
  app.post('/api/auth/login', (req, res) => auth.handleLogin(req, res));
  app.post('/api/auth/logout', (req, res) => auth.handleLogout(req, res));
  app.get('/api/auth/session', (req, res) => auth.sessionInfo(req, res));
  app.get('/api/meta', (req, res) => {
    res.json(getAppMeta());
  });

  app.use((req, res, next) => {
    ready.then(() => next()).catch(next);
  });

  // Communication APIs (open for client/directory access)
  app.get('/api/status', async (req, res) => {
    const summary = await state.getSummary();
    res.json(summary);
  });

  app.get('/api/blocks/full', async (req, res) => {
    const blocks = await state.listBlocks();
    res.json({ blocks });
  });

  app.post('/api/letters', async (req, res) => {
    try {
      const { payload, ownerFingerprint, relayMetrics } = req.body;
      if (!payload || !ownerFingerprint) {
        res.status(400).json({ error: 'payload and ownerFingerprint are required' });
        return;
      }
      const block = await state.acceptLetter(payload, ownerFingerprint, relayMetrics);
      res.json({ block });
    } catch (error) {
      logger.error('Failed to accept letter', error.message);
      const statusCode = Number(error?.statusCode) || 500;
      res.status(statusCode).json({ error: error.message });
    }
  });

  app.post('/api/report', async (req, res) => {
    const result = await state.reportToDirectory('api-report');
    res.json(result);
  });

  app.post('/api/sync', async (req, res) => {
    const result = await state.syncFromDirectory();
    res.json(result);
  });

  // Admin APIs (require authentication)
  const requireAuth = auth.requireAuth;

  app.get('/api/config', requireAuth, async (req, res) => {
    const config = await state.config.get();
    res.json(config);
  });

  app.post('/api/config', async (req, res) => {
    const config = await state.config.update(req.body);
    res.json(config);
  });

  app.get('/api/tor/status', async (req, res) => {
    res.json(await torService.status());
  });

  app.post('/api/tor/start', async (req, res) => {
    res.json(await torService.start(req.body));
  });

  app.post('/api/tor/stop', async (req, res) => {
    res.json(await torService.stop());
  });

  app.get('/api/tor/config', async (req, res) => {
    res.json(await torService.config());
  });

  app.post('/api/tor/config', async (req, res) => {
    res.json(await torService.updateConfig(req.body));
  });

  // Relay WebUI API endpoints
  app.get('/api/relay/stats', async (req, res) => {
    const blocks = await state.listBlocks();
    const directoryProfile = await state.fetchDirectoryProfile();
    const computedReputation = typeof directoryProfile?.reputation === 'number'
      ? directoryProfile.reputation
      : Math.round((directoryProfile?.reachability ?? 0) * 100);
    
    res.json({
      blockHeight: blocks.length,
      cachedLetters: blocks.reduce((sum, b) => sum + (b.letters?.length || 0), 0),
      forwardCount: state.forwardCount || 0,
      reputation: Number.isFinite(computedReputation) ? computedReputation : 0
    });
  });

  app.get('/api/relay/directory/status', requireAuth, async (req, res) => {
    const config = await state.config.get();
    await state.ensureFingerprint(config.onion);
    res.json({
      registered: !!config.directoryUrl,
      directoryUrl: config.directoryUrl,
      nickname: config.nickname,
      publicAccessUrl: config.publicAccessUrl || '',
      fingerprint: state.fingerprint || 'N/A',
      lastReport: state.lastReportInfo || null
    });
  });

  app.post('/api/relay/directory/register', requireAuth, async (req, res) => {
    try {
      // 确保保存所有配置字段包括nickname和publicAccessUrl
      const normalizedDirectoryUrl = typeof req.body.directoryUrl === 'string'
        ? req.body.directoryUrl.trim()
        : req.body.directoryUrl;
      const normalizedHeartbeat = Number.parseInt(req.body.heartbeatInterval, 10);
      const normalizedNickname = typeof req.body.nickname === 'string'
        ? req.body.nickname.trim()
        : req.body.nickname;
      const rawPublicAccessUrl = typeof req.body.publicAccessUrl === 'string'
        ? req.body.publicAccessUrl.trim()
        : req.body.publicAccessUrl;

      const updateData = {
        directoryUrl: normalizedDirectoryUrl || req.body.directoryUrl,
        heartbeatInterval: Number.isFinite(normalizedHeartbeat) ? normalizedHeartbeat : req.body.heartbeatInterval
      };
      
      if (normalizedNickname !== undefined) {
        updateData.nickname = normalizedNickname;
      }
      
      if (req.body.publicAccessUrl !== undefined) {
        const sanitizedAccessUrl = rawPublicAccessUrl || '';
        updateData.publicAccessUrl = sanitizedAccessUrl;
        if (sanitizedAccessUrl) {
          updateData.publicUrl = sanitizedAccessUrl;
        }
      }
      
      await state.config.update(updateData);
      const result = await state.reportToDirectory('register');
      res.json({ success: true, ...result });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  });

  app.post('/api/relay/directory/unregister', requireAuth, async (req, res) => {
    await state.config.update({ directoryUrl: null });
    res.json({ success: true });
  });

  app.get('/api/relay/sync/status', requireAuth, async (req, res) => {
    const blocks = await state.listBlocks();
    const chainSize = JSON.stringify(blocks).length;
    
    res.json({
      syncing: false,
      progress: 100,
      latestHash: blocks[blocks.length - 1]?.hash || '—',
      lastSyncTime: state.lastSyncTime || null,
      chainSize,
      totalLetters: blocks.reduce((sum, b) => sum + (b.letters?.length || 0), 0)
    });
  });

  app.post('/api/relay/sync/start', requireAuth, async (req, res) => {
    const result = await state.syncFromDirectory();
    const blocks = await state.listBlocks();
    res.json({ success: true, height: blocks.length, ...result });
  });

  app.get('/api/relay/queue', requireAuth, async (req, res) => {
    const status = await state.getQueueStatus();
    res.json(status);
  });

  app.post('/api/relay/queue/clear', requireAuth, async (req, res) => {
    await state.clearQueue();
    res.json({ success: true });
  });

  app.get('/api/relay/tor/status', requireAuth, async (req, res) => {
    res.json(await torService.status());
  });

  app.post('/api/relay/tor/config', requireAuth, async (req, res) => {
    res.json(await torService.updateConfig(req.body));
  });

  app.post('/api/relay/tor/start', requireAuth, async (req, res) => {
    res.json(await torService.start(req.body));
  });

  app.post('/api/relay/tor/stop', requireAuth, async (req, res) => {
    res.json(await torService.stop());
  });

  const publicDir = path.resolve(path.join(__dirname, '../../web/relay'));
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

export function startRelayServer(port = process.env.PORT || 4700) {
  const app = createRelayServer();
  app.listen(port, () => {
    logger.info(`Relay server listening on http://localhost:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startRelayServer();
}
