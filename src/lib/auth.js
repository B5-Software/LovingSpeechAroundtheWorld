import crypto from 'node:crypto';
import path from 'node:path';
import { JsonStore } from './jsonStore.js';
import { modeDataPath } from './paths.js';
import { createLogger } from './logger.js';

const SESSION_COOKIE_PREFIX = 'lsa-session';
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

function scryptAsync(password, salt, keylen = 64) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, 64);
  return {
    algorithm: 'scrypt',
    salt: salt.toString('base64'),
    hash: derivedKey.toString('base64'),
    params: { N: 16384, r: 8, p: 1 }
  };
}

export async function verifyPassword(password, hashed) {
  if (!hashed || hashed.algorithm !== 'scrypt') return false;
  const salt = Buffer.from(hashed.salt, 'base64');
  const derivedKey = await scryptAsync(password, salt, 64);
  return crypto.timingSafeEqual(derivedKey, Buffer.from(hashed.hash, 'base64'));
}

export async function deriveKeyFromPassword(password, saltBase64, length = 32) {
  const salt = typeof saltBase64 === 'string' ? Buffer.from(saltBase64, 'base64') : saltBase64;
  return scryptAsync(password, salt, length);
}

export function generateRandomPassword(length = 20) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%';
  return Array.from({ length }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
}

export function renderAuthGatePage(title = 'Secure Console') {
  return `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title} · 登录</title>
      <style>
        :root { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, Roboto, 'Helvetica Neue', Arial, sans-serif;
          --primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          --glass-bg: rgba(15, 23, 42, 0.85);
          --glass-border: rgba(255, 255, 255, 0.08);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
          min-height: 100vh; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          background: #0f172a;
          background-image: 
            radial-gradient(circle at 20% 50%, rgba(120, 119, 198, 0.15), transparent 50%),
            radial-gradient(circle at 80% 80%, rgba(236, 72, 153, 0.12), transparent 50%),
            radial-gradient(circle at 40% 20%, rgba(59, 130, 246, 0.1), transparent 50%);
          color: #f8fafc;
          overflow: hidden;
        }
        body::before {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: radial-gradient(circle at 50% 50%, rgba(124, 58, 237, 0.05), transparent 70%);
          animation: pulse 8s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.05); }
        }
        .card { 
          position: relative;
          width: min(420px, 92vw); 
          padding: 3rem 2.5rem; 
          border-radius: 1.5rem; 
          background: var(--glass-bg);
          backdrop-filter: blur(20px) saturate(180%);
          box-shadow: 
            0 8px 32px rgba(0, 0, 0, 0.4),
            0 0 0 1px var(--glass-border),
            inset 0 0 0 1px rgba(255, 255, 255, 0.03);
          border: 1px solid var(--glass-border);
          animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .icon-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 64px;
          height: 64px;
          margin: 0 auto 1.5rem;
          border-radius: 50%;
          background: var(--primary-gradient);
          box-shadow: 0 8px 24px rgba(120, 119, 198, 0.3);
          font-size: 1.75rem;
        }
        h1 { 
          margin-top: 0; 
          margin-bottom: 0.5rem;
          font-size: 1.75rem;
          font-weight: 700;
          text-align: center;
          background: linear-gradient(135deg, #f8fafc, #cbd5e1);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        p { 
          color: #94a3b8; 
          text-align: center;
          margin-bottom: 2rem;
          line-height: 1.6;
        }
        label { 
          display: block; 
          font-size: 0.875rem; 
          margin-bottom: 0.5rem; 
          font-weight: 500;
          letter-spacing: 0.02em; 
          color: #cbd5e1;
        }
        input { 
          width: 100%; 
          padding: 0.875rem 1.125rem; 
          margin-bottom: 1.25rem;
          border-radius: 0.75rem; 
          border: 1.5px solid rgba(148, 163, 184, 0.2); 
          background: rgba(15, 23, 42, 0.6); 
          color: #f8fafc; 
          font-size: 1rem;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        input:focus { 
          outline: none;
          border-color: #818cf8;
          background: rgba(15, 23, 42, 0.8);
          box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.15);
        }
        button { 
          width: 100%; 
          margin-top: 0.5rem;
          padding: 1rem; 
          border-radius: 0.75rem; 
          border: none; 
          background: var(--primary-gradient);
          color: #fff; 
          font-size: 1rem; 
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        button:hover:not(:disabled) { 
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
        }
        button:active:not(:disabled) {
          transform: translateY(0);
        }
        button:disabled { 
          opacity: 0.6; 
          cursor: not-allowed;
          transform: none;
        }
        .status { 
          margin-top: 1.25rem; 
          font-size: 0.9rem; 
          min-height: 1.25rem;
          text-align: center;
          padding: 0.75rem;
          border-radius: 0.5rem;
          background: rgba(239, 68, 68, 0.1);
          color: #fca5a5;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }
        .status:empty {
          display: none;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon-badge">🔒</div>
        <h1>${title}</h1>
        <p>请输入 CLI 提供的访问密码以解锁控制台</p>
        <label for="password">访问密码</label>
        <input id="password" type="password" autocomplete="current-password" placeholder="••••••" />
        <button id="login-btn">🔓 解锁控制台</button>
        <div class="status" id="status"></div>
      </div>
      <script>
        const statusEl = document.getElementById('status');
        const btn = document.getElementById('login-btn');
        const input = document.getElementById('password');
        btn.addEventListener('click', async () => {
          const password = input.value.trim();
          if (!password) { statusEl.textContent = '请输入密码'; return; }
          btn.disabled = true; statusEl.textContent = '验证中…';
          try {
            const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
            if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || '登录失败'); }
            window.location.reload();
          } catch (error) {
            statusEl.textContent = error.message || '登录失败';
          } finally {
            btn.disabled = false;
          }
        });
        input.addEventListener('keyup', (event) => {
          if (event.key === 'Enter') {
            btn.click();
          }
        });
      </script>
    </body>
  </html>`;
}

function buildSessionCookieName(mode) {
  return `${SESSION_COOKIE_PREFIX}-${mode}`;
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = rest.join('=');
    return acc;
  }, {});
}

export class ModeAuthService {
  constructor(mode, options = {}) {
    this.mode = mode;
    this.logger = createLogger(`${mode}-auth`);
    const defaults = {
      owner: null,
      updatedAt: null
    };
    this.store = new JsonStore(path.join(modeDataPath(mode), 'auth.json'), defaults);
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.sessions = new Map();
    this.readyPromise = null;
  }

  async init() {
    if (!this.readyPromise) {
      this.readyPromise = this.bootstrap();
    }
    return this.readyPromise;
  }

  async bootstrap() {
    const data = await this.store.get();
    if (!data.owner) {
      const password = generateRandomPassword();
      const passwordHash = await hashPassword(password);
      await this.store.update(() => ({ owner: { passwordHash, role: 'owner', createdAt: new Date().toISOString() }, updatedAt: new Date().toISOString() }));
      this.logger.warn(`[${this.mode}] 初始 Owner 密码: ${password}`);
      return { generatedPassword: password };
    }
    return { generatedPassword: null };
  }

  async setOwnerPassword(newPassword) {
    const passwordHash = await hashPassword(newPassword);
    await this.store.update((current) => ({
      ...current,
      owner: { passwordHash, role: 'owner', updatedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString()
    }));
    this.sessions.clear();
    this.logger.info(`[${this.mode}] Owner 密码已通过 CLI 更新`);
  }

  async verifyOwnerPassword(password) {
    await this.init();
    const data = await this.store.get();
    return verifyPassword(password, data.owner?.passwordHash);
  }

  createSession(role = 'owner') {
    const token = crypto.randomBytes(48).toString('base64url');
    const record = {
      token,
      role,
      createdAt: Date.now(),
      lastSeen: Date.now()
    };
    this.sessions.set(token, record);
    return record;
  }

  getSessionFromRequest(req) {
    const authorization = req.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      const token = authorization.slice(7).trim();
      return this.validateSession(token);
    }
    const cookies = parseCookies(req.headers.cookie);
    const cookieName = buildSessionCookieName(this.mode);
    if (cookies[cookieName]) {
      return this.validateSession(cookies[cookieName]);
    }
    return null;
  }

  validateSession(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    const expired = session.lastSeen + this.sessionTtlMs < Date.now();
    if (expired) {
      this.sessions.delete(token);
      return null;
    }
    session.lastSeen = Date.now();
    return session;
  }

  destroySession(token) {
    if (token) {
      this.sessions.delete(token);
    }
  }

  setSessionCookie(res, token) {
    const cookieName = buildSessionCookieName(this.mode);
    const maxAge = Math.floor(this.sessionTtlMs / 1000);
    const cookie = `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
    res.setHeader('Set-Cookie', cookie);
  }

  clearSessionCookie(res) {
    const cookieName = buildSessionCookieName(this.mode);
    res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict`);
  }

  unauthorized(res) {
    res.status(401).json({ error: '需要认证' });
  }

  requireAuth = async (req, res, next) => {
    await this.init();
    const session = this.getSessionFromRequest(req);
    if (!session) {
      this.unauthorized(res);
      return;
    }
    req.auth = session;
    next();
  };

  async handleLogin(req, res) {
    const { password } = req.body || {};
    if (!password) {
      res.status(400).json({ error: '缺少密码' });
      return;
    }
    const valid = await this.verifyOwnerPassword(password);
    if (!valid) {
      this.logger.warn('登录失败: 密码错误');
      res.status(401).json({ error: '密码错误' });
      return;
    }
    const session = this.createSession('owner');
    this.setSessionCookie(res, session.token);
    res.json({ success: true, role: session.role, expiresInMs: this.sessionTtlMs });
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
      this.unauthorized(res);
      return;
    }
    res.json({ role: session.role, lastSeen: session.lastSeen, expiresInMs: session.lastSeen + this.sessionTtlMs - Date.now() });
  }
}
