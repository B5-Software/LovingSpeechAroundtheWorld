import express from 'express';
import bodyParser from 'body-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientState } from './state.js';
import { TorService } from '../../src/lib/torService.js';
import { createLogger } from '../../src/lib/logger.js';
import { ClientAuthService } from '../../src/lib/clientAuth.js';
import { getAppMeta } from '../../src/lib/appMeta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger('client-server');

export function createClientServer() {
  const app = express();
  const state = new ClientState();
  const torService = new TorService('client');
  const auth = new ClientAuthService(state.vault);
  const ready = Promise.all([state.init(), auth.init()]);

  app.use(bodyParser.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    ready.then(() => next()).catch(next);
  });

  const requireAuth = auth.requireAuth;
  const requireAdmin = auth.ensureRole('admin');
  const requireOwner = auth.ensureRole('owner');

  // Authentication endpoints
  app.post('/api/auth/login', (req, res) => auth.handleLogin(req, res));
  app.post('/api/auth/register', async (req, res) => {
    // Public registration with role forced to 'user'
    const body = { ...req.body, role: 'user' };
    const originalBody = req.body;
    req.body = body;
    await auth.handleRegister(req, res);
    req.body = originalBody;
  });
  app.get('/api/users', requireOwner, async (req, res) => {
    res.json({ users: await auth.listUsers() });
  });

  app.post('/api/users/create', requireOwner, async (req, res) => {
    // Owner can create users with any role
    await auth.handleRegister(req, res);
  });

  app.patch('/api/users/:id/role', requireOwner, async (req, res) => {
    try {
      const updated = await auth.updateUserRole(req.params.id, req.body?.role);
      res.json({ user: updated });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/users/change-password', requireAuth, async (req, res) => {
    try {
      const { oldPassword, newPassword } = req.body || {};
      if (!oldPassword || !newPassword) {
        res.status(400).json({ error: '需要提供旧密码与新密码' });
        return;
      }
      await auth.changePassword(req.user.id, oldPassword, newPassword);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.post('/api/auth/logout', (req, res) => auth.handleLogout(req, res));
  app.get('/api/auth/session', (req, res) => auth.sessionInfo(req, res));
  app.get('/api/meta', (req, res) => {
    res.json(getAppMeta());
  });

  app.get('/api/keys', requireAuth, async (req, res) => {
    res.json({ keys: await state.listKeys(req.user) });
  });

  app.post('/api/keys', requireAuth, async (req, res) => {
    const key = await state.createKey(req.user, req.body?.label);
    res.json({ key });
  });

  app.post('/api/keys/import', requireAuth, async (req, res) => {
    const { label, publicKey, privateKey } = req.body;
    if (!publicKey || !privateKey) {
      res.status(400).json({ error: 'publicKey and privateKey required' });
      return;
    }
    const key = await state.importKey(req.user, label, publicKey, privateKey);
    res.json({ key });
  });

  app.post('/api/letters', requireAuth, async (req, res) => {
    try {
      const { keyId, text, metadata, relayUrl } = req.body;
      const result = await state.composeLetter(req.user, { keyId, text, metadata, relayUrl });
      res.json(result);
    } catch (error) {
      logger.error('Compose letter failed', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sync', requireAuth, async (req, res) => {
    const result = await state.syncBlocks();
    res.json(result);
  });

  app.get('/api/letters/:keyId', requireAuth, async (req, res) => {
    try {
      const letters = await state.findLetters(req.user, req.params.keyId);
      res.json({ letters });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/config', requireAdmin, async (req, res) => {
    res.json(await state.config.get());
  });

  app.post('/api/config', requireAdmin, async (req, res) => {
    res.json(await state.updateConfig(req.body));
  });

  app.get('/api/tor/status', requireAdmin, async (req, res) => {
    res.json(await torService.status());
  });

  app.post('/api/tor/start', requireAdmin, async (req, res) => {
    res.json(await torService.start(req.body));
  });

  app.post('/api/tor/stop', requireAdmin, async (req, res) => {
    res.json(await torService.stop());
  });

  app.get('/api/tor/config', requireAdmin, async (req, res) => {
    res.json(await torService.config());
  });

  app.post('/api/tor/config', requireAdmin, async (req, res) => {
    res.json(await torService.updateConfig(req.body));
  });

  // Spark API endpoints
  app.get('/api/spark/status', requireAuth, (req, res) => {
    // TODO: 实现真实的Spark状态逻辑
    res.json({
      isPaired: false,
      days: 0,
      level: 0,
      partnerKey: null,
      pairString: null,
      remainingTime: 0,
      contributions: []
    });
  });

  app.post('/api/spark/pair', requireAuth, (req, res) => {
    const { keyId, pairString, partnerKeyId } = req.body;
    // TODO: 实现配对逻辑
    res.json({
      success: true,
      message: '火花配对功能即将推出'
    });
  });

  app.post('/api/spark/contribute', requireAuth, (req, res) => {
    const { type, keyId } = req.body;
    // TODO: 实现贡献记录
    res.json({
      success: true,
      addedHours: 0,
      message: '贡献功能即将推出'
    });
  });

  const publicDir = path.resolve(path.join(__dirname, '../../web/client'));
  const sharedDir = path.resolve(path.join(__dirname, '../../web/shared'));
  app.use('/shared', express.static(sharedDir));
  app.use(express.static(publicDir));
  app.use((req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}

export function startClientServer(port = process.env.PORT || 4800) {
  const app = createClientServer();
  app.listen(port, () => {
    logger.info(`Client UI running on http://localhost:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startClientServer();
}
