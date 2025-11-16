import path from 'node:path';
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { JsonStore } from './jsonStore.js';
import { modeDataPath } from './paths.js';
import { hashPassword, verifyPassword, generateRandomPassword, deriveKeyFromPassword } from './auth.js';
import { createLogger } from './logger.js';

const COOKIE_NAME = 'lsa-client-session';
const SESSION_TTL_MS = 15 * 60 * 1000;
const ROLE_WEIGHT = { user: 1, admin: 2, owner: 3 };

function normalizeUsername(username = '') {
  return username.trim().toLowerCase();
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export class ClientAuthService {
  constructor(vault) {
    this.vault = vault;
    this.logger = createLogger('client-auth');
    this.store = new JsonStore(path.join(modeDataPath('client'), 'users.json'), { users: [] });
    this.sessions = new Map();
    this.readyPromise = null;
  }

  async init() {
    if (!this.readyPromise) {
      this.readyPromise = this.bootstrapOwner();
    }
    return this.readyPromise;
  }

  async bootstrapOwner() {
    const data = await this.store.get();
    const ownerExists = data.users.some((user) => user.role === 'owner');
    if (ownerExists) {
      return { generatedPassword: null };
    }
    const password = generateRandomPassword();
    const passwordHash = await hashPassword(password);
    const encryptionSalt = crypto.randomBytes(16).toString('base64');
    const owner = {
      id: `usr_${nanoid(10)}`,
      username: 'owner',
      normalized: 'owner',
      role: 'owner',
      passwordHash,
      encryptionSalt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.store.update((current) => ({ users: [...current.users, owner] }));
    const vaultKey = await deriveKeyFromPassword(password, encryptionSalt);
    await this.vault.initializeVault(owner.id, vaultKey);
    this.logger.warn(`Client Owner 初始密码: ${password}`);
    console.log(`[Client] Initial Owner password: ${password}`); // eslint-disable-line no-console
    return { generatedPassword: password };
  }

  async registerUser(username, password, role = 'user') {
    await this.init();
    const normalized = normalizeUsername(username);
    if (!normalized) {
      throw new Error('用户名不能为空');
    }
    if (password.length < 8) {
      throw new Error('密码至少需要 8 位字符');
    }
    if (!ROLE_WEIGHT[role]) {
      throw new Error('未知的用户组');
    }
    if (role === 'owner') {
      throw new Error('禁止创建额外的 Owner');
    }
    const data = await this.store.get();
    if (data.users.some((user) => user.normalized === normalized)) {
      throw new Error('用户名已存在');
    }
    const passwordHash = await hashPassword(password);
    const encryptionSalt = crypto.randomBytes(16).toString('base64');
    const record = {
      id: `usr_${nanoid(10)}`,
      username,
      normalized,
      role,
      passwordHash,
      encryptionSalt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.store.update((current) => ({ users: [...current.users, record] }));
    const vaultKey = await deriveKeyFromPassword(password, encryptionSalt);
    await this.vault.initializeVault(record.id, vaultKey);
    return { user: record, vaultKey };
  }

  async findUserByUsername(username) {
    const normalized = normalizeUsername(username);
    const data = await this.store.get();
    return data.users.find((user) => user.normalized === normalized) || null;
  }

  async findUserById(userId) {
    const data = await this.store.get();
    return data.users.find((user) => user.id === userId) || null;
  }

  async verifyCredentials(username, password) {
    await this.init();
    const user = await this.findUserByUsername(username);
    if (!user) {
      return null;
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return null;
    }
    const vaultKey = await deriveKeyFromPassword(password, user.encryptionSalt);
    return { user, vaultKey };
  }

  createSession(user, vaultKey) {
    const token = crypto.randomBytes(48).toString('base64url');
    const session = {
      token,
      userId: user.id,
      role: user.role,
      username: user.username,
      vaultKey: Buffer.isBuffer(vaultKey) ? vaultKey.toString('base64') : vaultKey,
      createdAt: Date.now(),
      lastSeen: Date.now()
    };
    this.sessions.set(token, session);
    return session;
  }

  getSessionByToken(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.lastSeen + SESSION_TTL_MS < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    session.lastSeen = Date.now();
    return session;
  }

  getSessionFromRequest(req) {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const token = header.slice(7).trim();
      return this.getSessionByToken(token);
    }
    const cookies = (req.headers.cookie || '').split(';').reduce((memo, chunk) => {
      const [name, ...rest] = chunk.trim().split('=');
      if (!name) return memo;
      memo[name] = rest.join('=');
      return memo;
    }, {});
    if (cookies[COOKIE_NAME]) {
      return this.getSessionByToken(cookies[COOKIE_NAME]);
    }
    return null;
  }

  setSessionCookie(res, token) {
    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
    );
  }

  clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  }

  destroySession(token) {
    if (token) {
      this.sessions.delete(token);
    }
  }

  invalidateUserSessions(userId) {
    [...this.sessions.entries()].forEach(([token, session]) => {
      if (session.userId === userId) {
        this.sessions.delete(token);
      }
    });
  }

  requireAuth = async (req, res, next) => {
    try {
      await this.init();
      const session = this.getSessionFromRequest(req);
      if (!session) {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      req.user = {
        id: session.userId,
        role: session.role,
        username: session.username,
        vaultKey: session.vaultKey
      };
      next();
    } catch (error) {
      next(error);
    }
  };

  ensureRole(minRole) {
    const required = ROLE_WEIGHT[minRole] ?? ROLE_WEIGHT.user;
    return async (req, res, next) => {
      await this.init();
      const session = this.getSessionFromRequest(req);
      if (!session || (ROLE_WEIGHT[session.role] ?? 0) < required) {
        res.status(403).json({ error: '权限不足' });
        return;
      }
      req.user = {
        id: session.userId,
        role: session.role,
        username: session.username,
        vaultKey: session.vaultKey
      };
      next();
    };
  }

  async handleRegister(req, res) {
    try {
      const { username, password, role } = req.body || {};
      const { user } = await this.registerUser(username || '', password || '', role || 'user');
      res.json({ success: true, user: sanitizeUser(user) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async handleLogin(req, res) {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        res.status(400).json({ error: '请输入用户名与密码' });
        return;
      }
      const result = await this.verifyCredentials(username, password);
      if (!result) {
        res.status(401).json({ error: '用户名或密码错误' });
        return;
      }
      const session = this.createSession(result.user, result.vaultKey);
      this.setSessionCookie(res, session.token);
      res.json({
        success: true,
        user: sanitizeUser(result.user),
        session: {
          username: session.username,
          role: session.role,
          expiresInMs: SESSION_TTL_MS
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  handleLogout(req, res) {
    const session = this.getSessionFromRequest(req);
    if (session) {
      this.destroySession(session.token);
    }
    this.clearSessionCookie(res);
    res.json({ success: true });
  }

  async sessionInfo(req, res) {
    const session = this.getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: '未登录' });
      return;
    }
    res.json({
      username: session.username,
      role: session.role,
      expiresInMs: session.lastSeen + SESSION_TTL_MS - Date.now()
    });
  }

  async listUsers() {
    await this.init();
    const data = await this.store.get();
    return data.users.map(sanitizeUser);
  }

  async updateUserRole(userId, role) {
    await this.init();
    if (!ROLE_WEIGHT[role]) {
      throw new Error('未知的用户组');
    }
    const data = await this.store.get();
    const target = data.users.find((user) => user.id === userId);
    if (!target) {
      throw new Error('用户不存在');
    }
    if (target.role === 'owner') {
      throw new Error('无法更改 Owner 身份');
    }
    const updated = { ...target, role, updatedAt: new Date().toISOString() };
    await this.store.update((current) => ({
      users: current.users.map((user) => (user.id === userId ? updated : user))
    }));
    this.invalidateUserSessions(userId);
    return sanitizeUser(updated);
  }

  async changePassword(userId, oldPassword, newPassword) {
    await this.init();
    if (newPassword.length < 8) {
      throw new Error('新密码至少 8 位');
    }
    const user = await this.findUserById(userId);
    if (!user) {
      throw new Error('用户不存在');
    }
    const valid = await verifyPassword(oldPassword, user.passwordHash);
    if (!valid) {
      throw new Error('原密码错误');
    }
    const oldKey = await deriveKeyFromPassword(oldPassword, user.encryptionSalt);
    const newSalt = crypto.randomBytes(16).toString('base64');
    const newHash = await hashPassword(newPassword);
    const newKey = await deriveKeyFromPassword(newPassword, newSalt);
    await this.vault.rotateKey(user.id, oldKey, newKey);
    user.passwordHash = newHash;
    user.encryptionSalt = newSalt;
    user.updatedAt = new Date().toISOString();
    await this.store.update((current) => ({
      users: current.users.map((u) => (u.id === user.id ? user : u))
    }));
    this.invalidateUserSessions(user.id);
    return true;
  }

}
