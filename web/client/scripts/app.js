/**
 * 应用主程序 - 业务逻辑与 API 交互
 */

import { marked } from '../shared/vendor/marked.esm.js';
import DOMPurify from '../shared/vendor/dompurify.esm.js';
import { initNavigation, setNavigationGuard } from './navigation.js';
import { initAnimations } from './animations.js';
import { initSettings } from './settings.js';

const renderer = new marked.Renderer();
renderer.link = function link(href, title, text) {
  const normalizedHref = typeof href === 'string' ? href : '';
  const safeHref = normalizedHref.replace(/"/g, '&quot;');
  const safeTitle = title ? title.replace(/"/g, '&quot;') : '';
  const titleAttr = safeTitle ? ` title="${safeTitle}"` : '';
  return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false,
  renderer
});

// 初始化系统
const nav = initNavigation();
setNavigationGuard(checkPanelAccess);
const animations = initAnimations();
const settings = initSettings();

const ROLE_WEIGHT = { user: 1, admin: 2, owner: 3 };
const panelRoleRequirements = {
  'panel-network': 'admin',
  'panel-tor': 'admin',
  'panel-users': 'owner'
};

const securityPrefsKey = 'lovingspeech-security';
const DEFAULT_SESSION_TTL = 15 * 60 * 1000;

const authState = {
  user: null,
  expiresAt: null,
  sessionTimer: null,
  autoLockTimer: null,
  preferences: loadSecurityPreferences()
};

const authElements = {
  overlay: document.getElementById('auth-overlay'),
  form: document.getElementById('login-form'),
  error: document.getElementById('login-error'),
  submit: document.getElementById('login-submit-btn'),
  sessionBar: document.getElementById('session-bar'),
  roleBadge: document.getElementById('session-role-badge'),
  username: document.getElementById('session-username'),
  expiry: document.getElementById('session-expiry'),
  logoutBtn: document.getElementById('logout-btn')
};

const securityElements = {
  username: document.getElementById('security-username'),
  roleBadge: document.getElementById('security-role-badge'),
  countdown: document.getElementById('security-expiry-countdown'),
  forceLockBtn: document.getElementById('force-lock-btn'),
  passwordForm: document.getElementById('password-change-form'),
  passwordMessage: document.getElementById('password-change-message'),
  preferencesForm: document.getElementById('security-preferences-form'),
  autoLockSelect: document.getElementById('auto-lock-select'),
  toastToggle: document.getElementById('session-toast-toggle'),
  preferencesMessage: document.getElementById('security-preferences-message'),
  downloadBtn: document.getElementById('download-active-key-btn'),
  downloadHint: document.getElementById('download-key-hint'),
  createUserForm: document.getElementById('create-user-form'),
  createUserMessage: document.getElementById('create-user-message'),
  userTableBody: document.getElementById('user-table-body')
};

const clientState = {
  keys: [],
  selectedKeyId: null
};

let appBootstrapped = false;

// DOM 元素引用
const elements = {
  // 统计指标
  statKeys: document.getElementById('stat-keys'),
  statLetters: document.getElementById('stat-letters'),
  torStatusBadge: document.getElementById('tor-status-badge'),
  torProgressText: document.getElementById('tor-progress-text'),
  
  // 活动时间轴
  activityFeed: document.getElementById('activity-feed'),
  
  // 密钥相关
  keyListContainer: document.getElementById('key-list-container'),
  createKeyBtn: document.getElementById('create-key-btn'),
  importKeyForm: document.getElementById('import-key-form'),
  keyModal: document.getElementById('key-modal'),
  keyModalForm: document.getElementById('key-create-form'),
  keyModalInput: document.getElementById('key-label-input'),
  keyModalClose: document.getElementById('key-modal-close'),
  keyModalHint: document.getElementById('key-modal-hint'),
  
  // 情书创作
  composeForm: document.getElementById('compose-letter-form'),
  
  // 图书馆
  librarySyncBtn: document.getElementById('library-sync-btn'),
  syncStatusBadge: document.getElementById('sync-status-badge'),
  letterKeySelect: document.getElementById('letter-key-select'),
  lettersContainer: document.getElementById('letters-container'),
  letterModal: document.getElementById('letter-modal'),
  letterModalTitle: document.getElementById('letter-modal-title'),
  letterModalMeta: document.getElementById('letter-modal-meta'),
  letterModalContent: document.getElementById('letter-modal-content'),
  letterModalClose: document.getElementById('letter-modal-close'),
  
  // 网络配置
  networkConfigForm: document.getElementById('network-config-form'),
  networkConfigStatus: document.getElementById('network-config-status'),
  
  // Tor 配置
  torConfigForm: document.getElementById('tor-config-form'),
  torStatusMain: document.getElementById('tor-status-main'),
  torLogs: document.getElementById('tor-logs'),
  torStartBtn: document.getElementById('tor-start-btn'),
  torStopBtn: document.getElementById('tor-stop-btn'),
  
  // 快速操作
  quickSync: document.getElementById('quick-sync')
};

const letterState = {
  cache: [],
  activeIndex: null
};

const keyModalState = {
  defaultLabel: ''
};

async function loadAppMeta() {
  try {
    const response = await fetch('/api/meta');
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    const authorNode = document.getElementById('launcher-meta-author');
    const versionNode = document.getElementById('launcher-meta-version');
    if (authorNode) {
      authorNode.textContent = data.author || 'B5-Software';
    }
    if (versionNode) {
      versionNode.textContent = data.version ? `v${data.version}` : 'v0.0.0';
    }
  } catch (error) {
    console.warn('加载版本信息失败', error);
  }
}

// API 工具函数
async function fetchJson(url, options = {}) {
  const { skipAuthGuard = false, headers: customHeaders = {}, body, ...fetchOptions } = options;
  const normalizedBody = body === undefined || body === null || typeof body === 'string' ? body : JSON.stringify(body);
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...customHeaders
    },
    body: normalizedBody
  });
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    if (response.status === 401 && !skipAuthGuard) {
      handleSessionExpired();
    }
    const message = (isJson && payload?.error) ? payload.error : (typeof payload === 'string' ? payload : '请求失败');
    throw new Error(message || '请求失败');
  }
  return payload;
}

// 活动日志
function logActivity(message) {
  const feed = elements.activityFeed;
  if (!feed) return;
  
  const time = new Date().toLocaleTimeString('zh-CN', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  const item = document.createElement('li');
  item.className = 'timeline-item';
  item.innerHTML = `
    <strong>${message}</strong>
    <span class="timeline-time">${time}</span>
  `;
  
  feed.prepend(item);
  
  const items = feed.querySelectorAll('li');
  if (items.length > 8) {
    feed.removeChild(feed.lastElementChild);
  }
}

function refreshModalBodyLock() {
  const anyOpen = Boolean(
    elements.letterModal?.classList.contains('is-visible') ||
    elements.keyModal?.classList.contains('is-visible')
  );
  if (anyOpen) {
    document.body.classList.add('modal-open');
  } else {
    document.body.classList.remove('modal-open');
  }
}

function generateKeyLabel() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const random = Math.random().toString(36).slice(-4).toUpperCase();
  return `LoveKey-${stamp}-${random}`;
}

function openKeyModal() {
  if (!elements.keyModal) return;
  keyModalState.defaultLabel = generateKeyLabel();
  if (elements.keyModalInput) {
    elements.keyModalInput.value = keyModalState.defaultLabel;
  }
  if (elements.keyModalHint) {
    elements.keyModalHint.textContent = '密钥名称将作为展示标签，可选填。';
    elements.keyModalHint.classList.remove('is-error');
  }
  elements.keyModal.classList.add('is-visible');
  elements.keyModal.setAttribute('aria-hidden', 'false');
  if (elements.keyModalInput) {
    requestAnimationFrame(() => {
      elements.keyModalInput?.focus();
      elements.keyModalInput?.select();
    });
  }
  refreshModalBodyLock();
}

function closeKeyModal() {
  if (!elements.keyModal) return;
  elements.keyModal.classList.remove('is-visible');
  elements.keyModal.setAttribute('aria-hidden', 'true');
  elements.keyModalForm?.reset();
  if (elements.keyModalHint) {
    elements.keyModalHint.textContent = '密钥名称将作为展示标签，可选填。';
    elements.keyModalHint.classList.remove('is-error');
  }
  refreshModalBodyLock();
}

function loadSecurityPreferences() {
  const defaults = { autoLockMinutes: 15, sessionToast: true };
  try {
    const stored = localStorage.getItem(securityPrefsKey);
    return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
  } catch {
    return defaults;
  }
}

function saveSecurityPreferences() {
  try {
    localStorage.setItem(securityPrefsKey, JSON.stringify(authState.preferences));
  } catch (error) {
    console.debug('无法保存安全偏好', error);
  }
}

function applySecurityPreferencesUI() {
  if (securityElements.autoLockSelect) {
    securityElements.autoLockSelect.value = String(authState.preferences.autoLockMinutes);
  }
  if (securityElements.toastToggle) {
    securityElements.toastToggle.checked = Boolean(authState.preferences.sessionToast);
  }
}

function hasRole(required) {
  if (!required) return true;
  const current = authState.user?.role || 'user';
  return (ROLE_WEIGHT[current] || 0) >= (ROLE_WEIGHT[required] || 0);
}

function checkPanelAccess(panelId) {
  const required = panelRoleRequirements[panelId];
  if (!required) return true;
  if (hasRole(required)) return true;
  logActivity(`⚠️ 需要 ${required.toUpperCase()} 权限才能访问该面板`);
  return false;
}

function updateRoleVisibility() {
  const nodes = document.querySelectorAll('[data-role-required]');
  nodes.forEach((node) => {
    const required = node.getAttribute('data-role-required');
    const hideIfLocked = node.getAttribute('data-hide-if-locked') === 'true';
    const allowed = hasRole(required);
    if (allowed) {
      node.classList.remove('is-role-locked');
      node.removeAttribute('data-role-message');
      if (hideIfLocked) {
        node.removeAttribute('hidden');
      }
      if (node instanceof HTMLButtonElement) {
        node.disabled = node.dataset.prevDisabled === '1' ? true : false;
      }
    } else if (hideIfLocked) {
      node.setAttribute('hidden', 'hidden');
    } else {
      node.classList.add('is-role-locked');
      node.dataset.roleMessage = `${required?.toUpperCase() || ''} 权限受限`;
      if (node instanceof HTMLButtonElement) {
        node.dataset.prevDisabled = node.disabled ? '1' : '0';
        node.disabled = true;
      }
    }
  });
}

function showAuthOverlay(message = '') {
  if (!authElements.overlay) return;
  authElements.overlay.setAttribute('aria-hidden', 'false');
  if (authElements.error) {
    authElements.error.textContent = message;
  }
}

function hideAuthOverlay() {
  if (!authElements.overlay) return;
  authElements.overlay.setAttribute('aria-hidden', 'true');
  if (authElements.error) {
    authElements.error.textContent = '';
  }
  authElements.form?.reset();
}

function updateSessionUI() {
  if (!authElements.sessionBar) return;
  if (authState.user) {
    authElements.sessionBar.removeAttribute('hidden');
    authElements.username.textContent = authState.user.username;
    authElements.roleBadge.textContent = authState.user.role.toUpperCase();
  } else {
    authElements.sessionBar.setAttribute('hidden', 'hidden');
    authElements.username.textContent = '未登录';
    authElements.roleBadge.textContent = '访客';
    authElements.expiry.textContent = '—';
  }
}

function updateSecurityPanel() {
  if (!securityElements.username) return;
  if (authState.user) {
    securityElements.username.textContent = authState.user.username;
    securityElements.roleBadge.textContent = authState.user.role.toUpperCase();
  } else {
    securityElements.username.textContent = '—';
    securityElements.roleBadge.textContent = '—';
  }
}

function startSessionCountdown(expiresInMs) {
  clearInterval(authState.sessionTimer);
  if (!expiresInMs) {
    authElements.expiry.textContent = '—';
    if (securityElements.countdown) securityElements.countdown.textContent = '—';
    return;
  }
  authState.expiresAt = Date.now() + expiresInMs;
  const update = () => {
    if (!authState.expiresAt) return;
    const remaining = Math.max(authState.expiresAt - Date.now(), 0);
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    const formatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    authElements.expiry.textContent = `剩余 ${formatted}`;
    if (securityElements.countdown) {
      securityElements.countdown.textContent = formatted;
    }
    if (remaining === 0) {
      handleSessionExpired();
    }
  };
  update();
  authState.sessionTimer = window.setInterval(update, 1000);
}

function scheduleAutoLock() {
  clearTimeout(authState.autoLockTimer);
  if (!authState.user) return;
  const minutes = Number(authState.preferences.autoLockMinutes) || 0;
  if (!minutes) return;
  authState.autoLockTimer = window.setTimeout(() => {
    logActivity('🔒 由于长时间未操作，会话已自动锁定');
    handleSessionExpired('已自动锁定，请重新登录');
  }, minutes * 60 * 1000);
}

function resetAutoLockTimer() {
  if (!authState.user) return;
  scheduleAutoLock();
}

function handleSessionExpired(message = '会话已过期，请重新登录') {
  authState.user = null;
  authState.expiresAt = null;
  clearInterval(authState.sessionTimer);
  clearTimeout(authState.autoLockTimer);
  clientState.keys = [];
  clientState.selectedKeyId = null;
  letterState.cache = [];
  letterState.activeIndex = null;
  if (elements.keyListContainer) {
    elements.keyListContainer.innerHTML = '<p class="empty-hint">登录后管理密钥</p>';
  }
  if (elements.lettersContainer) {
    elements.lettersContainer.innerHTML = '<p class="empty-hint">登录后查看情书</p>';
  }
  if (elements.statKeys) {
    elements.statKeys.textContent = '0';
  }
  if (elements.statLetters) {
    elements.statLetters.textContent = '0';
  }
  if (elements.letterKeySelect) {
    elements.letterKeySelect.value = '';
  }
  updateDownloadButtonState('');
  if (securityElements.passwordMessage) {
    securityElements.passwordMessage.textContent = '';
  }
  if (securityElements.createUserMessage) {
    securityElements.createUserMessage.textContent = '';
  }
  if (securityElements.userTableBody) {
    securityElements.userTableBody.innerHTML = '<tr><td colspan="5" class="empty-hint">登录 Owner 账户以查看成员</td></tr>';
  }
  updateSessionUI();
  updateSecurityPanel();
  updateRoleVisibility();
  if (authState.preferences.sessionToast) {
    logActivity('🔒 ' + message);
  }
  showAuthOverlay(message);
}

async function refreshSession() {
  try {
    const session = await fetchJson('/api/auth/session', { skipAuthGuard: true });
    applySession(session);
    return session;
  } catch {
    return null;
  }
}

function applySession(session) {
  if (!session) return;
  const expiresIn = Number(session.expiresInMs) || DEFAULT_SESSION_TTL;
  authState.user = { username: session.username, role: session.role };
  authElements.form?.reset?.();
  if (authElements.error) {
    authElements.error.textContent = '';
  }
  hideAuthOverlay();
  updateSessionUI();
  updateSecurityPanel();
  updateRoleVisibility();
  startSessionCountdown(expiresIn);
  updateDownloadButtonState(elements.letterKeySelect?.value);
  scheduleAutoLock();
  if (hasRole('owner')) {
    loadUserDirectory().catch(() => {});
  }
}

async function startAppAfterAuth() {
  if (!authState.user) return;
  if (!appBootstrapped) {
    await initApp();
    initMarkdownEditor();
    appBootstrapped = true;
  } else {
    await reloadAppData();
  }
}

async function reloadAppData() {
  await loadKeys();
  await loadLetters();
  if (hasRole('admin')) {
    await loadNetworkConfig();
    await loadTorConfig();
    await refreshTorStatus();
  }
  await refreshSparkStatus();
}

function showFormMessage(element, message, tone = 'info') {
  if (!element) return;
  element.textContent = message;
  element.style.color = tone === 'error' ? '#f87171' : '#a5b4fc';
}

function downloadKeyById(keyId) {
  if (!keyId) {
    alert('请选择要导出的密钥');
    return;
  }
  const key = clientState.keys.find((k) => k.id === keyId);
  if (!key) {
    alert('未找到指定的密钥');
    return;
  }
  const payload = {
    id: key.id,
    label: key.label,
    publicKey: key.publicKey,
    privateKey: key.privateKey,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${key.label || 'lovekey'}-${key.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  logActivity(`🧾 已导出密钥 ${key.label}`);
}

function updateDownloadButtonState(keyId) {
  clientState.selectedKeyId = keyId || '';
  if (!securityElements.downloadBtn) return;
  const hasKey = Boolean(keyId && clientState.keys.some((k) => k.id === keyId));
  securityElements.downloadBtn.disabled = !hasKey;
  if (hasKey) {
    securityElements.downloadBtn.dataset.keyId = keyId;
    if (securityElements.downloadHint) {
      securityElements.downloadHint.textContent = '点击按钮导出所选密钥。';
    }
  } else {
    delete securityElements.downloadBtn.dataset.keyId;
    if (securityElements.downloadHint) {
      securityElements.downloadHint.textContent = '请选择密钥或在密钥工坊中点击“导出”按钮。';
    }
  }
}

function escapeHtml(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function renderUserTable(users = []) {
  if (!securityElements.userTableBody) return;
  if (!Array.isArray(users) || users.length === 0) {
    securityElements.userTableBody.innerHTML = '<tr><td colspan="5" class="empty-hint">暂无成员</td></tr>';
    return;
  }
  const sorted = [...users].sort((a, b) => (ROLE_WEIGHT[b.role] || 0) - (ROLE_WEIGHT[a.role] || 0));
  securityElements.userTableBody.innerHTML = sorted
    .map((user) => {
      const isOwner = user.role === 'owner';
      const roleControl = isOwner
        ? `<span class="role-chip">OWNER</span>`
        : `<select class="user-role-select" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}">
            <option value="user" ${user.role === 'user' ? 'selected' : ''}>普通用户</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>管理员</option>
          </select>`;
      return `
        <tr data-user-id="${user.id}">
          <td>${escapeHtml(user.username)}</td>
          <td>${roleControl}</td>
          <td>${formatTimestamp(user.createdAt)}</td>
          <td>${formatTimestamp(user.updatedAt)}</td>
          <td>${isOwner ? '—' : '角色变更立即生效'}</td>
        </tr>
      `;
    })
    .join('');
}

async function loadUserDirectory() {
  if (!hasRole('owner') || !securityElements.userTableBody) return;
  try {
    securityElements.userTableBody.innerHTML = '<tr><td colspan="5" class="empty-hint">加载中…</td></tr>';
    const data = await fetchJson('/api/users');
    renderUserTable(data.users || []);
  } catch (error) {
    securityElements.userTableBody.innerHTML = `<tr><td colspan="5" class="empty-hint">${escapeHtml(error.message || '无法加载用户')}</td></tr>`;
  }
}

function setLoginError(message = '') {
  if (authElements.error) {
    authElements.error.textContent = message;
  }
}

function updateSecurityPreferences(partial = {}) {
  authState.preferences = { ...authState.preferences, ...partial };
  saveSecurityPreferences();
  applySecurityPreferencesUI();
  scheduleAutoLock();
  if (securityElements.preferencesMessage) {
    showFormMessage(securityElements.preferencesMessage, '✅ 会话策略已更新');
  }
}

function attachAuthHandlers() {
  let isRegisterMode = false;

  const toggleLink = document.getElementById('toggle-register-link');
  const authTitle = document.getElementById('auth-title');
  const authDescription = document.getElementById('auth-description');
  const authSubmitText = document.getElementById('auth-submit-text');
  const authHint = document.getElementById('auth-hint');

  toggleLink?.addEventListener('click', (event) => {
    event.preventDefault();
    isRegisterMode = !isRegisterMode;
    
    if (isRegisterMode) {
      authTitle.textContent = '注册新账户';
      authDescription.textContent = '创建账户后即可使用所有功能。';
      authSubmitText.textContent = '创建账户';
      authHint.innerHTML = '已有账户? <a href="#" id="toggle-register-link">返回登录</a>';
    } else {
      authTitle.textContent = '登录星河客户端';
      authDescription.textContent = '请使用 CLI 创建的账户登录以解锁所有功能。';
      authSubmitText.textContent = '解锁客户端';
      authHint.innerHTML = '还没有账户? <a href="#" id="toggle-register-link">立即注册</a>';
    }
    
    // 重新绑定切换链接
    const newToggleLink = document.getElementById('toggle-register-link');
    newToggleLink?.addEventListener('click', (e) => {
      e.preventDefault();
      toggleLink.click();
    });
    
    if (authElements.error) {
      authElements.error.textContent = '';
    }
  });

  authElements.form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(authElements.form);
    const username = (formData.get('username') || '').trim();
    const password = formData.get('password') || '';
    if (!username || !password) {
      setLoginError('请输入用户名与密码');
      return;
    }
    setLoginError('');
    if (authElements.submit) {
      authElements.submit.disabled = true;
    }
    try {
      if (isRegisterMode) {
        // 注册模式
        await fetchJson('/api/auth/register', {
          method: 'POST',
          skipAuthGuard: true,
          body: { username, password }
        });
        logActivity('✨ 注册成功，正在登录...');
        // 注册成功后自动登录
        const response = await fetchJson('/api/auth/login', {
          method: 'POST',
          skipAuthGuard: true,
          body: { username, password }
        });
        const session = response.session || {
          username: response.user?.username || username,
          role: response.user?.role || 'user',
          expiresInMs: DEFAULT_SESSION_TTL
        };
        applySession(session);
        logActivity('🔓 登录成功');
        await startAppAfterAuth();
      } else {
        // 登录模式
        const response = await fetchJson('/api/auth/login', {
          method: 'POST',
          skipAuthGuard: true,
          body: { username, password }
        });
        const session = response.session || {
          username: response.user?.username || username,
          role: response.user?.role || 'user',
          expiresInMs: DEFAULT_SESSION_TTL
        };
        applySession(session);
        logActivity('🔓 登录成功');
        await startAppAfterAuth();
      }
    } catch (error) {
      setLoginError(error.message || (isRegisterMode ? '注册失败' : '登录失败'));
    } finally {
      if (authElements.submit) {
        authElements.submit.disabled = false;
      }
    }
  });

  authElements.logoutBtn?.addEventListener('click', async () => {
    try {
      await fetchJson('/api/auth/logout', { method: 'POST', skipAuthGuard: true });
    } catch (error) {
      console.debug('退出登录失败', error);
    }
    handleSessionExpired('已退出登录');
  });

  securityElements.forceLockBtn?.addEventListener('click', async () => {
    try {
      await fetchJson('/api/auth/logout', { method: 'POST', skipAuthGuard: true });
    } catch {}
    handleSessionExpired('已手动锁定客户端');
  });
}

function attachSecurityHandlers() {
  securityElements.passwordForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authState.user) {
      showFormMessage(securityElements.passwordMessage, '请先登录', 'error');
      return;
    }
    const formData = new FormData(securityElements.passwordForm);
    const oldPassword = formData.get('oldPassword') || '';
    const newPassword = formData.get('newPassword') || '';
    const confirmPassword = formData.get('confirmPassword') || '';
    if (!oldPassword || !newPassword) {
      showFormMessage(securityElements.passwordMessage, '请输入完整信息', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showFormMessage(securityElements.passwordMessage, '两次新密码不一致', 'error');
      return;
    }
    try {
      await fetchJson('/api/users/change-password', {
        method: 'POST',
        body: { oldPassword, newPassword }
      });
      showFormMessage(securityElements.passwordMessage, '✅ 密码已更新，请重新登录');
      securityElements.passwordForm.reset();
      logActivity('🔐 已更新账户密码');
      try {
        await fetchJson('/api/auth/logout', { method: 'POST', skipAuthGuard: true });
      } catch {}
      setTimeout(() => {
        handleSessionExpired('密码已更新，请重新登录');
      }, 600);
    } catch (error) {
      showFormMessage(securityElements.passwordMessage, error.message || '更新失败', 'error');
    }
  });

  securityElements.autoLockSelect?.addEventListener('change', (event) => {
    const minutes = Number(event.target.value) || 0;
    updateSecurityPreferences({ autoLockMinutes: minutes });
  });

  securityElements.toastToggle?.addEventListener('change', (event) => {
    updateSecurityPreferences({ sessionToast: Boolean(event.target.checked) });
  });

  securityElements.downloadBtn?.addEventListener('click', () => {
    const targetKeyId = clientState.selectedKeyId || securityElements.downloadBtn?.dataset?.keyId;
    if (!targetKeyId) {
      alert('请选择要导出的密钥');
      return;
    }
    downloadKeyById(targetKeyId);
  });

  securityElements.preferencesForm?.addEventListener('submit', (event) => {
    event.preventDefault();
  });

  securityElements.createUserForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!hasRole('owner')) {
      showFormMessage(securityElements.createUserMessage, '只有 Owner 可以创建账户', 'error');
      return;
    }
    const formData = new FormData(securityElements.createUserForm);
    const username = (formData.get('username') || '').trim();
    const password = (formData.get('password') || '').trim();
    const role = formData.get('role') || 'user';
    if (!username || !password) {
      showFormMessage(securityElements.createUserMessage, '请输入用户名与临时密码', 'error');
      return;
    }
    try {
      await fetchJson('/api/auth/register', {
        method: 'POST',
        body: { username, password, role }
      });
      securityElements.createUserForm.reset();
      showFormMessage(securityElements.createUserMessage, `✅ 已创建 ${username}，请立即告知临时密码`);
      logActivity(`👤 创建了新用户 ${username}`);
      await loadUserDirectory();
    } catch (error) {
      showFormMessage(securityElements.createUserMessage, error.message || '创建失败', 'error');
    }
  });

  securityElements.userTableBody?.addEventListener('change', async (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    if (!select.classList.contains('user-role-select')) return;
    const userId = select.dataset.userId;
    const username = select.dataset.username || userId;
    const role = select.value;
    try {
      await fetchJson(`/api/users/${userId}/role`, {
        method: 'PATCH',
        body: { role }
      });
      showFormMessage(securityElements.createUserMessage, `✅ 已将 ${username} 设为 ${role.toUpperCase()}`);
      logActivity(`🛡️ 更新 ${username} 的角色为 ${role}`);
      await loadUserDirectory();
    } catch (error) {
      showFormMessage(securityElements.createUserMessage, error.message || '角色更新失败', 'error');
      await loadUserDirectory();
    }
  });
}

function installAutoLockListeners() {
  ['click', 'keydown', 'mousemove', 'touchstart'].forEach((eventName) => {
    document.addEventListener(eventName, () => resetAutoLockTimer(), { passive: true });
  });
}

function attachSessionBarToggle() {
  const sessionBar = document.getElementById('session-bar');
  const toggleBtn = document.getElementById('session-toggle');
  
  if (!sessionBar || !toggleBtn) return;
  
  // 更新session-bar高度CSS变量
  const updateSessionBarHeight = () => {
    const height = sessionBar.offsetHeight;
    document.documentElement.style.setProperty('--session-bar-height', `${height}px`);
  };
  
  // 初始化时设置高度
  updateSessionBarHeight();
  
  // 监听session-bar高度变化
  const resizeObserver = new ResizeObserver(updateSessionBarHeight);
  resizeObserver.observe(sessionBar);

  const syncSessionToggle = () => {
    requestAnimationFrame(() => updateSessionBarHeight());
  };
  
  // 从localStorage恢复折叠状态
  const collapsed = localStorage.getItem('session-bar-collapsed') === 'true';
  if (collapsed) {
    sessionBar.classList.add('collapsed');
    syncSessionToggle();
  }
  
  toggleBtn.addEventListener('click', () => {
    sessionBar.classList.toggle('collapsed');
    const isCollapsed = sessionBar.classList.contains('collapsed');
    localStorage.setItem('session-bar-collapsed', String(isCollapsed));
    syncSessionToggle();
  });

  sessionBar.addEventListener('transitionstart', syncSessionToggle);
  sessionBar.addEventListener('transitionend', syncSessionToggle);
}

// ========== 密钥管理 ==========
async function loadKeys() {
  const data = await fetchJson('/api/keys');
  clientState.keys = data.keys || [];
  
  if (elements.statKeys) {
    elements.statKeys.textContent = data.keys.length;
  }
  
  const options = clientState.keys.map(key => 
    `<option value="${key.id}">${escapeHtml(key.label)}</option>`
  ).join('');
  
  const composeSelect = elements.composeForm?.querySelector('select[name="keyId"]');
  if (composeSelect) {
    composeSelect.innerHTML = '<option value="">—— 请选择密钥 ——</option>' + options;
  }
  
  if (elements.letterKeySelect) {
    elements.letterKeySelect.innerHTML = '<option value="">—— 请选择密钥 ——</option>' + options;
  }
  
  if (elements.keyListContainer) {
    if (clientState.keys.length === 0) {
      elements.keyListContainer.innerHTML = '<p class="empty-hint">暂无密钥，请先创建或导入</p>';
    } else {
      elements.keyListContainer.innerHTML = clientState.keys.map(key => `
        <div class="card-item">
          <p><strong>🔑 ${escapeHtml(key.label)}</strong></p>
          <small style="font-family:monospace;color:var(--muted-gray);">${key.id}</small>
          <div class="key-actions">
            <button class="key-action-btn" data-action="download-key" data-key-id="${key.id}">
              <i class="fas fa-file-export"></i> 导出
            </button>
          </div>
        </div>
      `).join('');
    }
  }

  updateDownloadButtonState(elements.letterKeySelect?.value);
}

elements.createKeyBtn?.addEventListener('click', () => openKeyModal());

elements.keyModalForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = event.submitter || elements.keyModalForm.querySelector('button[type="submit"]');
  submitter?.classList.add('is-busy');
  if (submitter) submitter.disabled = true;
  const rawLabel = elements.keyModalInput?.value?.trim();
  const label = rawLabel || keyModalState.defaultLabel || generateKeyLabel();
  try {
    await fetchJson('/api/keys', {
      method: 'POST',
      body: { label }
    });
    closeKeyModal();
    await loadKeys();
    logActivity(`⚡ 铸造了新的密钥对: ${label}`);
    if (sparkData.active) {
      await addSparkContribution('key', 12);
      logActivity('🔑 创建密钥，火花 +12小时');
    }
  } catch (error) {
    if (elements.keyModalHint) {
      elements.keyModalHint.textContent = error.message || '创建失败，请稍后重试';
      elements.keyModalHint.classList.add('is-error');
    }
  } finally {
    if (submitter) {
      submitter.disabled = false;
      submitter.classList.remove('is-busy');
    }
  }
});

elements.importKeyForm?.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  const formData = new FormData(elements.importKeyForm);
  await fetchJson('/api/keys/import', {
    method: 'POST',
    body: Object.fromEntries(formData.entries())
  });
  elements.importKeyForm.reset();
  await loadKeys();
  logActivity('📥 召唤了一对现有密钥');
});

elements.keyListContainer?.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-action="download-key"]');
  if (!button) return;
  downloadKeyById(button.dataset.keyId);
});

// ========== 情书创作 ==========
elements.composeForm?.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  const formData = new FormData(elements.composeForm);
  const payload = Object.fromEntries(formData.entries());
  
  await fetchJson('/api/letters', {
    method: 'POST',
    body: {
      keyId: payload.keyId,
      text: payload.text,
      metadata: { title: payload.title },
      relayUrl: payload.relayUrl || undefined
    }
  });
  
  elements.composeForm.reset();
  logActivity('🚀 情书已加密并发送至星河');
  await loadLetters();
  
  // 如果火花激活,增加贡献
  if (sparkData.active) {
    await addSparkContribution('letter', 24);
    logActivity('💌 发送情书，火花 +24小时');
  }
  
  nav.navigateTo('panel-library');
});

// ========== 图书馆 ==========
async function loadLetters() {
  const keyId = elements.letterKeySelect?.value;
  updateDownloadButtonState(keyId);
  if (!keyId) {
    letterState.cache = [];
    closeLetterModal();
    if (elements.lettersContainer) {
      elements.lettersContainer.innerHTML = '<p class="empty-hint">请先选择密钥以解锁情书</p>';
    }
    if (elements.statLetters) {
      elements.statLetters.textContent = 0;
    }
    return;
  }
  
  const data = await fetchJson(`/api/letters/${keyId}`);
  const letters = data.letters ?? [];
  letterState.cache = letters;
  letterState.activeIndex = null;
  closeLetterModal();
  
  if (elements.statLetters) {
    elements.statLetters.textContent = letters.length;
  }
  
  if (elements.lettersContainer) {
    if (letters.length === 0) {
      elements.lettersContainer.innerHTML = '<p class="empty-hint">暂无内容，尝试同步星河链</p>';
    } else {
      elements.lettersContainer.innerHTML = letters
        .map((letter, index) => renderLetterCard(letter, index))
        .join('');
    }
  }
}

function renderLetterCard(letter, index) {
  const title = escapeHtml(letter.metadata?.title || '无题');
  const metaParts = [];
  if (typeof letter.blockIndex === 'number') {
    metaParts.push(`#${letter.blockIndex}`);
  }
  if (letter.timestamp) {
    metaParts.push(escapeHtml(letter.timestamp));
  }
  const metaText = metaParts.join(' · ') || '—';
  return `
    <article class="card-item letter-card" data-letter-index="${index}" role="button" tabindex="0">
      <p><strong>💌 ${title}</strong></p>
      <p class="letter-snippet">正文已加密存储，点击查看 Markdown 原文</p>
      <small class="letter-meta">${metaText}</small>
    </article>
  `;
}

function openLetterModal(letter, index) {
  if (!elements.letterModal) return;
  letterState.activeIndex = index;
  const title = letter.metadata?.title || '无题';
  const metaTokens = [];
  if (typeof letter.blockIndex === 'number') {
    metaTokens.push(`#${letter.blockIndex}`);
  }
  if (letter.timestamp) {
    metaTokens.push(letter.timestamp);
  }
  elements.letterModalTitle.textContent = title;
  elements.letterModalMeta.textContent = metaTokens.join(' · ') || '—';
  const raw = letter.plaintext?.trim() || '_正文为空_';
  const safeHtml = DOMPurify.sanitize(marked.parse(raw));
  elements.letterModalContent.innerHTML = safeHtml;
  elements.letterModal.classList.add('is-visible');
  elements.letterModal.setAttribute('aria-hidden', 'false');
  refreshModalBodyLock();
}

function closeLetterModal() {
  if (!elements.letterModal) return;
  elements.letterModal.classList.remove('is-visible');
  elements.letterModal.setAttribute('aria-hidden', 'true');
  refreshModalBodyLock();
  letterState.activeIndex = null;
}

function activateLetterFromEvent(target) {
  if (!target) return;
  const card = target.closest?.('.letter-card');
  if (!card) return;
  const index = Number(card.dataset.letterIndex);
  if (!Number.isInteger(index)) return;
  const letter = letterState.cache[index];
  if (letter) {
    openLetterModal(letter, index);
  }
}

elements.lettersContainer?.addEventListener('click', (event) => {
  activateLetterFromEvent(event.target);
});

elements.lettersContainer?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    activateLetterFromEvent(event.target);
  }
});

elements.letterModalClose?.addEventListener('click', () => closeLetterModal());

elements.letterModal?.addEventListener('click', (event) => {
  if (event.target?.closest?.('[data-modal-close]')) {
    closeLetterModal();
  }
});

elements.keyModalClose?.addEventListener('click', () => closeKeyModal());

elements.keyModal?.addEventListener('click', (event) => {
  if (event.target?.closest?.('[data-modal-close]')) {
    closeKeyModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (elements.keyModal?.classList.contains('is-visible')) {
    closeKeyModal();
    return;
  }
  if (elements.letterModal?.classList.contains('is-visible')) {
    closeLetterModal();
  }
});

function setSyncControlsBusy(isBusy) {
  const controlIds = ['library-sync-btn', 'quick-sync', 'dock-sync-btn', 'spark-sync-btn'];
  controlIds.forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (isBusy) {
      if (!btn.dataset.prevDisabled) {
        btn.dataset.prevDisabled = btn.disabled ? '1' : '0';
      }
      btn.disabled = true;
      btn.classList.add('is-syncing');
      const icon = btn.querySelector('.fa-sync-alt');
      icon?.classList.add('fa-spin');
    } else {
      const wasDisabled = btn.dataset.prevDisabled === '1';
      btn.disabled = wasDisabled;
      if (!wasDisabled) {
        btn.disabled = false;
      }
      btn.classList.remove('is-syncing');
      const icon = btn.querySelector('.fa-sync-alt');
      icon?.classList.remove('fa-spin');
      delete btn.dataset.prevDisabled;
    }
  });
}

async function syncBlockchain(options = {}) {
  const { source = 'manual', logSuccess = true } = options;
  setSyncControlsBusy(true);
  if (elements.syncStatusBadge) {
    elements.syncStatusBadge.textContent = '同步中…';
  }
  try {
    const result = await fetchJson('/api/sync', { method: 'POST' });
    if (elements.syncStatusBadge) {
      elements.syncStatusBadge.textContent = result.updated ? '✨ 获得最新链' : '✅ 已是最新';
    }
    await loadLetters();
    updateDockBadges();
    if (logSuccess) {
      const message = source === 'quick-action' ? '✨ 通过快捷操作完成链同步' : '🔄 星河链已同步';
      logActivity(message);
    }
    return result;
  } catch (error) {
    if (elements.syncStatusBadge) {
      elements.syncStatusBadge.textContent = '⚠️ 同步失败';
    }
    logActivity('⚠️ 链同步失败，请稍后重试');
    throw error;
  } finally {
    setSyncControlsBusy(false);
  }
}

elements.librarySyncBtn?.addEventListener('click', () => syncBlockchain({ source: 'panel-library' }));
elements.quickSync?.addEventListener('click', () => syncBlockchain({ source: 'quick-action' }));
elements.letterKeySelect?.addEventListener('change', (event) => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement)) return;
  updateDownloadButtonState(select.value);
  loadLetters();
});

// ========== 网络配置 ==========
async function loadNetworkConfig() {
  const config = await fetchJson('/api/config');
  const form = elements.networkConfigForm;
  if (form) {
    form.directoryUrl.value = config.directoryUrl ?? '';
    form.preferredRelay.value = config.preferredRelay ?? '';
  }
}

elements.networkConfigForm?.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  const formData = new FormData(elements.networkConfigForm);
  await fetchJson('/api/config', {
    method: 'POST',
    body: Object.fromEntries(formData.entries())
  });
  
  if (elements.networkConfigStatus) {
    elements.networkConfigStatus.textContent = '✅ 已保存';
    setTimeout(() => {
      elements.networkConfigStatus.textContent = '待保存';
    }, 2500);
  }
  
  logActivity('💾 更新了网络偏好');
});

// ========== Tor 配置 ==========
async function loadTorConfig() {
  const config = await fetchJson('/api/tor/config');
  const form = elements.torConfigForm;
  if (form) {
    form.torPath.value = config.torPath ?? '';
    form.socksPort.value = config.socksPort ?? '';
    form.controlPort.value = config.controlPort ?? '';
    form.bridges.value = (config.bridges ?? []).join('\n');
  }
}

elements.torConfigForm?.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  const formData = new FormData(elements.torConfigForm);
  await fetchJson('/api/tor/config', {
    method: 'POST',
    body: {
      torPath: formData.get('torPath').trim() || 'tor',
      socksPort: Number(formData.get('socksPort')) || 9150,
      controlPort: Number(formData.get('controlPort')) || 9151,
      bridges: formData.get('bridges').split('\n').map(line => line.trim()).filter(Boolean)
    }
  });
  logActivity('💾 保存了 Tor 隧道配置');
});

async function refreshTorStatus() {
  const status = await fetchJson('/api/tor/status');
  
  const statusText = status.running ? '🔥 已点燃' : '❄️ 待命';
  const progressText = `Bootstrapped ${status.progress ?? 0}%`;
  
  if (elements.torStatusBadge) {
    elements.torStatusBadge.textContent = statusText;
  }
  if (elements.torStatusMain) {
    elements.torStatusMain.textContent = statusText;
  }
  if (elements.torProgressText) {
    elements.torProgressText.textContent = progressText;
  }
  if (elements.torLogs) {
    elements.torLogs.textContent = (status.logs ?? []).join('\n') || '等待 Tor 启动…';
  }
}

elements.torStartBtn?.addEventListener('click', async () => {
  await fetchJson('/api/tor/start', { method: 'POST', body: {} });
  await refreshTorStatus();
  logActivity('🔥 点燃了洋葱隧道');
});

elements.torStopBtn?.addEventListener('click', async () => {
  await fetchJson('/api/tor/stop', { method: 'POST' });
  await refreshTorStatus();
  logActivity('❄️ 熄灭了 Tor 通道');
});

// ========== 初始化加载 ==========
async function initApp() {
  try {
    await loadKeys();
    await loadLetters();
    if (hasRole('admin')) {
      await loadNetworkConfig();
      await loadTorConfig();
      await refreshTorStatus();
    }
    await initSparkFeature();
    initDockActions();
    
    setInterval(() => {
      if (!authState.user) return;
      if (hasRole('admin')) {
        refreshTorStatus().catch(() => {});
      }
      refreshSparkStatus().catch(() => {});
    }, 6000);
    
    console.log('✨ 让爱遍布于世界角落 - 系统已启动');
  } catch (error) {
    console.error('初始化失败:', error);
    logActivity('⚠️ 系统初始化遇到问题');
  }
}

// ========== 火花功能 ==========
let sparkData = {
  active: false,
  days: 0,
  level: 0,
  remainingHours: 0,
  pairString: '',
  partnerKeyId: '',
  keyId: '',
  contributions: []
};

async function initSparkFeature() {
  // 加载火花状态
  await refreshSparkStatus();
  
  // 绑定火花配对表单
  const sparkPairForm = document.getElementById('spark-pair-form');
  if (sparkPairForm) {
    sparkPairForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(sparkPairForm);
      
      try {
        const result = await fetchJson('/api/spark/pair', {
          method: 'POST',
          body: {
            keyId: formData.get('keyId'),
            pairString: formData.get('pairString'),
            partnerKeyId: formData.get('partnerKeyId') || undefined
          }
        });
        
        logActivity('🔥 火花已点燃！');
        await refreshSparkStatus();
        sparkPairForm.reset();
      } catch (error) {
        alert('火花点燃失败: ' + error.message);
      }
    });
  }
  
  // 绑定火花同步按钮
  const sparkSyncBtn = document.getElementById('spark-sync-btn');
  if (sparkSyncBtn) {
    sparkSyncBtn.addEventListener('click', async () => {
      try {
        await syncBlockchain({ source: 'spark-panel', logSuccess: false });
        await addSparkContribution('sync', 6);
        logActivity('🔄 同步区块链，火花 +6小时');
      } catch (error) {
        console.error('同步失败:', error);
      }
    });
  }
  
  // 填充密钥选择器
  const sparkKeySelect = sparkPairForm?.querySelector('select[name="keyId"]');
  if (sparkKeySelect) {
    const keys = await fetchJson('/api/keys');
    sparkKeySelect.innerHTML = '<option value="">—— 请选择密钥 ——</option>' +
      keys.keys.map(k => `<option value="${k.id}">${k.label}</option>`).join('');
  }
}

async function refreshSparkStatus() {
  try {
    const data = await fetchJson('/api/spark/status');
    sparkData = data;
    
    updateSparkUI(data);
    updateDockSparkBadge(data);
  } catch (error) {
    // 火花功能可能尚未实现,静默处理
    console.debug('火花状态获取失败:', error);
  }
}

function updateSparkUI(data) {
  const {
    active = false,
    days = 0,
    level = 0,
    remainingHours = 0,
    pairString = '',
    partnerKeyId = '',
    keyId = '',
    contributions = []
  } = data;
  
  // 更新火花天数显示
  const daysDisplay = document.querySelector('.days-number');
  if (daysDisplay) daysDisplay.textContent = days;
  
  // 更新火花状态文本
  const statusText = document.getElementById('spark-status-text');
  if (statusText) {
    statusText.textContent = active ? `燃烧中 🔥` : '未点燃';
  }
  
  // 更新火花等级
  const levelBadge = document.getElementById('spark-level-badge');
  if (levelBadge) {
    levelBadge.textContent = `Lv.${level}`;
  }
  
  // 更新火花状态描述
  const statusDesc = document.getElementById('spark-status-desc');
  if (statusDesc) {
    if (active) {
      statusDesc.textContent = `已持续 ${days} 天，继续保持贡献让火花永不熄灭`;
    } else {
      statusDesc.textContent = '与TA配对后开始燃烧属于你们的火花';
    }
  }
  
  // 更新进度条
  const progressFill = document.getElementById('spark-progress-fill');
  const progressText = document.getElementById('spark-progress-text');
  if (progressFill && progressText) {
    const percentage = (remainingHours / 24) * 100;
    progressFill.style.width = `${percentage}%`;
    progressText.textContent = `${remainingHours.toFixed(1)}h / 24h`;
  }
  
  // 更新剩余时间
  const remainingTimeEl = document.getElementById('spark-remaining-time');
  if (remainingTimeEl) {
    if (active) {
      const hours = Math.floor(remainingHours);
      const minutes = Math.floor((remainingHours - hours) * 60);
      remainingTimeEl.textContent = `${hours}小时${minutes}分钟`;
    } else {
      remainingTimeEl.textContent = '—';
    }
  }
  
  // 更新配对信息
  const partnerKeyEl = document.getElementById('spark-partner-key');
  if (partnerKeyEl) {
    partnerKeyEl.textContent = partnerKeyId || '未配对';
  }
  
  const pairStringEl = document.getElementById('spark-pair-string');
  if (pairStringEl) {
    pairStringEl.textContent = pairString || '—';
  }
  
  // 更新火焰视觉效果
  const flameContainer = document.getElementById('spark-flame-viz');
  if (flameContainer) {
    if (active) {
      flameContainer.classList.add('burning');
    } else {
      flameContainer.classList.remove('burning');
    }
  }
  
  // 更新贡献历史
  const historyList = document.getElementById('spark-history-list');
  if (historyList && contributions.length > 0) {
    historyList.innerHTML = contributions.map(c => `
      <div class="timeline-item">
        <strong>${getContributionLabel(c.type)} +${c.hours}小时</strong>
        <span class="timeline-time">${new Date(c.timestamp).toLocaleString('zh-CN')}</span>
      </div>
    `).join('');
  }
  
  // 火花卡片状态
  const sparkCard = document.querySelector('.spark-status-card');
  if (sparkCard) {
    if (active) {
      sparkCard.classList.add('active');
    } else {
      sparkCard.classList.remove('active');
    }
  }
}

function getContributionLabel(type) {
  const labels = {
    letter: '💌 发送情书',
    sync: '🔄 同步区块',
    key: '🔑 创建密钥',
    premium: '💎 续燃 Premium'
  };
  return labels[type] || '✨ 其他贡献';
}

async function addSparkContribution(type, hours) {
  try {
    await fetchJson('/api/spark/contribute', {
      method: 'POST',
      body: { type, hours }
    });
    
    await refreshSparkStatus();
  } catch (error) {
    console.debug('火花贡献记录失败:', error);
  }
}

// ========== Dock栏交互 ==========
function initDockActions() {
  // Dock同步按钮
  const dockSyncBtn = document.getElementById('dock-sync-btn');
  if (dockSyncBtn) {
    dockSyncBtn.addEventListener('click', async () => {
      try {
        await syncBlockchain({ source: 'dock' });
        
        // 如果火花激活,增加贡献
        if (sparkData.active) {
          await addSparkContribution('sync', 6);
        }
      } catch (error) {
        console.error('同步失败:', error);
      }
    });
  }
  
  // Dock Tor切换按钮
  const dockTorToggle = document.getElementById('dock-tor-toggle');
  if (dockTorToggle) {
    dockTorToggle.addEventListener('click', async () => {
      try {
        const status = await fetchJson('/api/tor/status');
        
        if (status.running) {
          await fetchJson('/api/tor/stop', { method: 'POST' });
          logActivity('❄️ Tor 隧道已关闭');
        } else {
          await fetchJson('/api/tor/start', { method: 'POST' });
          logActivity('🔥 Tor 隧道已开启');
        }
        
        await refreshTorStatus();
      } catch (error) {
        console.error('Tor切换失败:', error);
      }
    });
  }
  
  // 更新Dock徽章
  updateDockBadges();
}

function updateDockBadges() {
  // 更新情书库徽章
  const lettersBadge = document.getElementById('dock-letters-badge');
  if (lettersBadge && elements.statLetters) {
    lettersBadge.textContent = elements.statLetters.textContent;
  }
}

function updateDockSparkBadge(data) {
  const sparkBadge = document.getElementById('dock-spark-badge');
  if (sparkBadge) {
    if (data.active) {
      sparkBadge.textContent = `${data.days}天`;
      sparkBadge.style.background = 'linear-gradient(135deg, #f59e0b, #ec4899)';
    } else {
      sparkBadge.textContent = '未点燃';
      sparkBadge.style.background = 'rgba(148, 163, 184, 0.5)';
    }
  }
}

// 监听面板切换以更新Dock状态
window.addEventListener('panel-changed', (e) => {
  updateDockBadges();
});

// Markdown编辑器功能
function initMarkdownEditor() {
  const textarea = document.getElementById('letter-content');
  const preview = document.getElementById('markdown-preview');
  const toolbar = document.getElementById('markdown-toolbar');
  const helpToggle = document.getElementById('toggle-markdown-help');
  const helpPanel = document.getElementById('markdown-help-panel');
  const modeButtons = document.querySelectorAll('[data-editor-mode]');

  if (!textarea || !preview || !toolbar) return;

  let currentMode = 'edit';

  const dispatchInput = () => {
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const renderPreview = () => {
    const raw = textarea.value || '';
    const safeHtml = DOMPurify.sanitize(marked.parse(raw));
    preview.innerHTML = safeHtml || '<p class="empty-hint">还没有文字，快写下第一句话吧。</p>';
  };

  function setMode(mode) {
    currentMode = mode;
    modeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.editorMode === mode));
    if (mode === 'preview') {
      textarea.classList.add('is-hidden');
      preview.classList.remove('is-hidden');
      renderPreview();
    } else {
      textarea.classList.remove('is-hidden');
      preview.classList.add('is-hidden');
      textarea.focus();
    }
  }

  const wrapSelection = (before, after, placeholder = '') => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.slice(start, end) || placeholder;
    const nextValue = text.slice(0, start) + before + selected + after + text.slice(end);
    textarea.value = nextValue;
    const cursorStart = start + before.length;
    const cursorEnd = cursorStart + selected.length;
    textarea.focus();
    textarea.setSelectionRange(cursorStart, cursorEnd);
    dispatchInput();
  };

  const prefixSelection = (prefix) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selection = text.slice(start, end);

    if (!selection) {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const lineEndIndex = text.indexOf('\n', start);
      const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
      const line = text.slice(lineStart, lineEnd);
      const hasPrefix = line.trimStart().startsWith(`${prefix} `);
      const updatedLine = hasPrefix ? line : (line ? `${prefix} ${line}` : `${prefix} `);
      textarea.value = text.slice(0, lineStart) + updatedLine + text.slice(lineEnd);
      const cursor = lineStart + updatedLine.length;
      textarea.setSelectionRange(cursor, cursor);
      dispatchInput();
      return;
    }

    const updated = selection
      .split('\n')
      .map((line) => {
        const hasPrefix = line.trimStart().startsWith(`${prefix} `);
        if (hasPrefix) return line;
        return line ? `${prefix} ${line}` : `${prefix} `;
      })
      .join('\n');
    textarea.value = text.slice(0, start) + updated + text.slice(end);
    textarea.setSelectionRange(start, start + updated.length);
    dispatchInput();
  };

  const applyFormat = (format) => {
    switch (format) {
      case 'bold':
        wrapSelection('**', '**', '加粗文本');
        break;
      case 'italic':
        wrapSelection('*', '*', '斜体文本');
        break;
      case 'heading':
        prefixSelection('#');
        break;
      case 'list':
        prefixSelection('-');
        break;
      case 'quote':
        prefixSelection('>');
        break;
      case 'code': {
        const selection = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
        if (selection.includes('\n')) {
          wrapSelection('```\n', '\n```', '代码块');
        } else {
          wrapSelection('`', '`', 'code');
        }
        break;
      }
      case 'link': {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selected = text.slice(start, end) || '链接文字';
        const urlPlaceholder = 'https://example.com';
        const snippet = `[${selected}](${urlPlaceholder})`;
        textarea.value = text.slice(0, start) + snippet + text.slice(end);
        const cursorStart = start + snippet.indexOf(urlPlaceholder);
        const cursorEnd = cursorStart + urlPlaceholder.length;
        textarea.focus();
        textarea.setSelectionRange(cursorStart, cursorEnd);
        dispatchInput();
        break;
      }
      default:
        break;
    }
  };

  toolbar.querySelectorAll('[data-format]').forEach((btn) => {
    btn.addEventListener('click', () => applyFormat(btn.dataset.format));
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.editorMode;
      if (mode && mode !== currentMode) {
        setMode(mode);
      }
    });
  });

  textarea.addEventListener('input', () => {
    if (currentMode === 'preview') {
      renderPreview();
    }
  });

  helpToggle?.addEventListener('click', () => {
    if (!helpPanel) return;
    helpPanel.classList.toggle('is-hidden');
    const visible = !helpPanel.classList.contains('is-hidden');
    helpToggle.classList.toggle('active', visible);
    helpToggle.setAttribute('aria-expanded', String(visible));
  });

  setMode('edit');
  renderPreview();
}

async function bootstrapClientApp() {
  loadAppMeta();
  applySecurityPreferencesUI();
  attachAuthHandlers();
  attachSecurityHandlers();
  installAutoLockListeners();
  attachSessionBarToggle();
  const session = await refreshSession();
  if (session) {
    await startAppAfterAuth();
  } else {
    showAuthOverlay();
  }
}

bootstrapClientApp();

