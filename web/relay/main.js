// Relay Node Main Script

class RelayApp {
  constructor() {
    this.theme = localStorage.getItem('relay-theme') || 'dark';
    this.refreshInterval = null;
    this.init();
  }

  init() {
    this.applyTheme();
    this.bindEvents();
    this.loadMeta();
    this.loadData();
    this.startAutoRefresh();
  }

  // 主题切换
  applyTheme() {
    if (this.theme === 'light') {
      document.body.classList.add('light-mode');
      document.querySelector('#theme-toggle i').className = 'fas fa-sun';
    } else {
      document.body.classList.remove('light-mode');
      document.querySelector('#theme-toggle i').className = 'fas fa-moon';
    }
  }

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('relay-theme', this.theme);
    this.applyTheme();
  }

  // 绑定事件
  bindEvents() {
    document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());
    document.getElementById('refresh-btn').addEventListener('click', () => this.loadData());
    
    // 目录注册
    document.getElementById('save-config-btn').addEventListener('click', () => {
      const form = document.getElementById('directory-register-form');
      this.saveDirectoryConfig(new FormData(form));
    });
    document.getElementById('directory-register-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.registerToDirectory(new FormData(e.target));
    });
    document.getElementById('unregister-btn').addEventListener('click', () => this.unregisterFromDirectory());
    
    // 区块链同步
    document.getElementById('sync-now-btn').addEventListener('click', () => this.syncBlockchain());
    
    // 转发队列
    document.getElementById('clear-queue-btn').addEventListener('click', () => this.clearQueue());
    
    // Tor控制
    document.getElementById('tor-config-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveTorConfig(new FormData(e.target));
    });
    document.getElementById('tor-start-btn').addEventListener('click', () => this.startTor());
    document.getElementById('tor-stop-btn').addEventListener('click', () => this.stopTor());
    document.getElementById('copy-onion-btn').addEventListener('click', () => this.copyOnionAddress());
    
    // 日志
    document.getElementById('clear-logs-btn').addEventListener('click', () => this.clearLogs());
  }

  // 加载数据
  async loadData() {
    try {
      const refreshBtn = document.getElementById('refresh-btn');
      refreshBtn.querySelector('i').style.animation = 'spin 1s linear infinite';
      
      await Promise.all([
        this.loadStats(),
        this.loadDirectoryStatus(),
        this.loadSyncStatus(),
        this.loadQueue(),
        this.loadTorStatus()
      ]);
      
      refreshBtn.querySelector('i').style.animation = '';
      this.addLog('success', '数据刷新完成');
    } catch (error) {
      console.error('加载数据失败:', error);
      this.addLog('error', `数据加载失败: ${error.message}`);
    }
  }

  async loadMeta() {
    try {
      const response = await fetch('/api/meta');
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const author = data.author || 'B5-Software';
      const versionLabel = data.version ? `v${data.version}` : '';
      const target = document.getElementById('app-meta');
      if (target) {
        target.textContent = versionLabel ? `${author} · ${versionLabel}` : author;
      }
    } catch (error) {
      console.warn('加载版本信息失败', error);
    }
  }

  // 加载统计数据
  async loadStats() {
    try {
      const response = await fetch('/api/relay/stats');
      const data = await response.json();
      
      document.getElementById('stat-blocks').textContent = data.blockHeight || 0;
      document.getElementById('stat-letters').textContent = data.cachedLetters || 0;
      document.getElementById('stat-forwards').textContent = data.forwardCount || 0;
      document.getElementById('stat-reputation').textContent = (data.reputation || 100) + '%';
    } catch (error) {
      console.error('加载统计失败:', error);
    }
  }

  // 加载目录注册状态
  async loadDirectoryStatus() {
    try {
      const response = await fetch('/api/relay/directory/status');
      const data = await response.json();
      
      console.log('📡 加载目录状态:', data);
      
      const badge = document.getElementById('directory-status-badge');
      const fingerprintInput = document.getElementById('relay-fingerprint');
      const nicknameInput = document.querySelector('[name="nickname"]');
      const publicAccessUrlInput = document.querySelector('[name="publicAccessUrl"]');
      
      console.log('🔍 publicAccessUrl input元素:', publicAccessUrlInput);
      console.log('🔍 从API获取的publicAccessUrl值:', data.publicAccessUrl);
      
      if (data.registered) {
        badge.textContent = '已注册';
        badge.className = 'badge online';
        fingerprintInput.value = data.fingerprint || 'N/A';
      } else {
        badge.textContent = '未注册';
        badge.className = 'badge offline';
      }
      
      // 填充目录URL和nickname和publicAccessUrl
      if (data.directoryUrl) {
        document.querySelector('[name="directoryUrl"]').value = data.directoryUrl;
      }
      
      if (data.nickname && nicknameInput) {
        nicknameInput.value = data.nickname;
      }
      
      if (publicAccessUrlInput) {
        const valueToSet = data.publicAccessUrl || '';
        publicAccessUrlInput.value = valueToSet;
        console.log('✅ 已设置publicAccessUrl输入框的值为:', valueToSet);
      } else {
        console.error('❌ 找不到publicAccessUrl输入框元素');
      }
    } catch (error) {
      console.error('加载目录状态失败:', error);
    }
  }

  // 加载同步状态
  async loadSyncStatus() {
    try {
      const response = await fetch('/api/relay/sync/status');
      const data = await response.json();
      
      const badge = document.getElementById('sync-status-badge');
      const progress = document.getElementById('sync-progress');
      const progressText = document.getElementById('sync-progress-text');
      
      document.getElementById('latest-hash').textContent = data.latestHash || '—';
      document.getElementById('last-sync-time').textContent = this.formatTime(data.lastSyncTime) || '从未同步';
      document.getElementById('chain-size').textContent = this.formatSize(data.chainSize || 0);
      document.getElementById('total-letters-count').textContent = data.totalLetters || 0;
      
      if (data.syncing) {
        badge.textContent = '同步中';
        badge.className = 'badge syncing';
        progress.style.width = (data.progress || 0) + '%';
        progressText.textContent = `正在同步: ${data.progress || 0}%`;
      } else {
        badge.textContent = '已同步';
        badge.className = 'badge online';
        progress.style.width = '100%';
        progressText.textContent = '区块链已是最新状态';
      }
    } catch (error) {
      console.error('加载同步状态失败:', error);
    }
  }

  // 加载转发队列
  async loadQueue() {
    try {
      const response = await fetch('/api/relay/queue');
      const data = await response.json();
      
      const tbody = document.getElementById('queue-tbody');
      
      // API返回的是对象，不是数组
      const queueItems = data.items || [];
      
      if (!queueItems || queueItems.length === 0) {
        tbody.innerHTML = `
          <tr class="empty-row">
            <td colspan="5">
              <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>转发队列为空</p>
              </div>
            </td>
          </tr>
        `;
        return;
      }
      
      tbody.innerHTML = queueItems.map((item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><code class="mono">${item.id?.substring(0, 16) || 'N/A'}...</code></td>
          <td><code class="mono">${(item.ownerFingerprint || 'N/A').substring(0, 12)}...</code></td>
          <td>${this.formatTime(item.enqueuedAt)}</td>
          <td>
            <span class="badge ${item.attempts > 0 ? 'warning' : ''}">
              ${item.attempts > 0 ? `重试 ${item.attempts}` : '待转发'}
            </span>
          </td>
        </tr>
      `).join('');
    } catch (error) {
      console.error('加载队列失败:', error);
    }
  }

  // 加载Tor状态
  async loadTorStatus() {
    try {
      const response = await fetch('/api/relay/tor/status');
      const data = await response.json();
      
      const badge = document.getElementById('tor-status-badge');
      if (data.running) {
        badge.textContent = '运行中';
        badge.className = 'badge online';
        
        if (data.onionAddress) {
          document.getElementById('onion-address').value = data.onionAddress;
        }
      } else {
        badge.textContent = '离线';
        badge.className = 'badge offline';
      }
    } catch (error) {
      console.error('加载Tor状态失败:', error);
    }
  }

  // 保存目录配置（不注册）
  async saveDirectoryConfig(formData) {
    try {
      // 详细调试 FormData
      console.log('🔍 FormData 所有字段:');
      for (const [key, value] of formData.entries()) {
        console.log(`  ${key}:`, value);
      }
      
      const rawPublicAccessUrl = formData.get('publicAccessUrl');
      console.log('🔍 获取到的 publicAccessUrl 原始值:', rawPublicAccessUrl, '(类型:', typeof rawPublicAccessUrl, ')');
      
      const config = {
        directoryUrl: formData.get('directoryUrl'),
        nickname: (formData.get('nickname') || '').trim(),
        publicAccessUrl: rawPublicAccessUrl ? rawPublicAccessUrl.trim() : '',
        heartbeatInterval: parseInt(formData.get('heartbeatInterval'), 10)
      };
      
      console.log('💾 准备保存配置（不注册）:', config);
      
      const response = await fetch('/api/relay/directory/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      
      const result = await response.json();
      
      console.log('📥 保存配置响应:', result);
      
      if (result.success) {
        this.addLog('success', '✅ 配置已保存');
        await this.loadDirectoryStatus();
        return true;
      } else {
        this.addLog('error', `保存失败: ${result.message}`);
        return false;
      }
    } catch (error) {
      console.error('保存配置失败:', error);
      this.addLog('error', `保存配置失败: ${error.message}`);
      return false;
    }
  }

  // 注册到目录（保存配置并向目录报告）
  async registerToDirectory(formData) {
    try {
      // 详细调试 FormData
      console.log('🔍 FormData 所有字段:');
      for (const [key, value] of formData.entries()) {
        console.log(`  ${key}:`, value);
      }
      
      const rawPublicAccessUrl = formData.get('publicAccessUrl');
      console.log('🔍 获取到的 publicAccessUrl 原始值:', rawPublicAccessUrl, '(类型:', typeof rawPublicAccessUrl, ')');
      
      const config = {
        directoryUrl: formData.get('directoryUrl'),
        nickname: (formData.get('nickname') || '').trim(),
        publicAccessUrl: rawPublicAccessUrl ? rawPublicAccessUrl.trim() : '',
        heartbeatInterval: parseInt(formData.get('heartbeatInterval'), 10)
      };
      
      console.log('📤 准备注册到目录，配置:', config);
      
      const response = await fetch('/api/relay/directory/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      
      const result = await response.json();
      
      console.log('📥 注册响应:', result);
      
      if (result.success) {
        this.addLog('success', '✅ 成功注册到目录服务器');
        await this.loadDirectoryStatus();
      } else {
        this.addLog('error', `注册失败: ${result.message}`);
      }
    } catch (error) {
        this.addLog('success', '✅ 成功注册到目录服务器');
        await this.loadDirectoryStatus();
      } else {
        this.addLog('error', `注册失败: ${result.message}`);
      }
    } catch (error) {
      this.addLog('error', `注册失败: ${error.message}`);
    }
  }

  // 取消注册
  async unregisterFromDirectory() {
    try {
      const response = await fetch('/api/relay/directory/unregister', { method: 'POST' });
      const result = await response.json();
      
      this.addLog('info', '已从目录服务器取消注册');
      await this.loadDirectoryStatus();
    } catch (error) {
      this.addLog('error', `取消注册失败: ${error.message}`);
    }
  }

  // 同步区块链
  async syncBlockchain() {
    try {
      const btn = document.getElementById('sync-now-btn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>同步中...</span>';
      
      const response = await fetch('/api/relay/sync/start', { method: 'POST' });
      const result = await response.json();
      
      this.addLog('success', `区块链同步完成，当前高度: ${result.height}`);
      await this.loadSyncStatus();
      
    } catch (error) {
      this.addLog('error', `同步失败: ${error.message}`);
    } finally {
      const btn = document.getElementById('sync-now-btn');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-cloud-download-alt"></i><span>立即同步</span>';
    }
  }

  // 清空队列
  async clearQueue() {
    try {
      const response = await fetch('/api/relay/queue/clear', { method: 'POST' });
      this.addLog('info', '转发队列已清空');
      await this.loadQueue();
    } catch (error) {
      this.addLog('error', `清空队列失败: ${error.message}`);
    }
  }

  // Tor配置
  async saveTorConfig(formData) {
    try {
      const config = {
        torPath: formData.get('torPath'),
        hiddenServicePort: parseInt(formData.get('hiddenServicePort'))
      };
      
      const response = await fetch('/api/relay/tor/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      
      const result = await response.json();
      this.addLog('success', 'Tor配置已保存');
    } catch (error) {
      this.addLog('error', `保存配置失败: ${error.message}`);
    }
  }

  async startTor() {
    try {
      const btn = document.getElementById('tor-start-btn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>启动中...</span>';
      
      const response = await fetch('/api/relay/tor/start', { method: 'POST' });
      const result = await response.json();
      
      this.addLog('success', 'Tor服务已启动');
      await this.loadTorStatus();
      
    } catch (error) {
      this.addLog('error', `启动Tor失败: ${error.message}`);
    } finally {
      const btn = document.getElementById('tor-start-btn');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-play-circle"></i><span>启动</span>';
    }
  }

  async stopTor() {
    try {
      const response = await fetch('/api/relay/tor/stop', { method: 'POST' });
      this.addLog('info', 'Tor服务已停止');
      await this.loadTorStatus();
    } catch (error) {
      this.addLog('error', `停止Tor失败: ${error.message}`);
    }
  }

  copyOnionAddress() {
    const input = document.getElementById('onion-address');
    input.select();
    document.execCommand('copy');
    this.addLog('info', '洋葱地址已复制到剪贴板');
  }

  // 日志
  addLog(level, message) {
    const container = document.getElementById('activity-logs');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    
    const now = new Date();
    const time = now.toLocaleTimeString('zh-CN', { hour12: false });
    
    entry.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-level ${level}">
        <i class="fas fa-${this.getLogIcon(level)}"></i> ${level.toUpperCase()}
      </span>
      <span class="log-message">${message}</span>
    `;
    
    container.insertBefore(entry, container.firstChild);
    
    // 限制日志条数
    const entries = container.querySelectorAll('.log-entry');
    if (entries.length > 100) {
      entries[entries.length - 1].remove();
    }
  }

  getLogIcon(level) {
    const icons = {
      info: 'info-circle',
      success: 'check-circle',
      warning: 'exclamation-triangle',
      error: 'times-circle'
    };
    return icons[level] || 'circle';
  }

  clearLogs() {
    document.getElementById('activity-logs').innerHTML = `
      <div class="log-entry">
        <span class="log-time">${new Date().toLocaleTimeString('zh-CN', { hour12: false })}</span>
        <span class="log-level info"><i class="fas fa-info-circle"></i> INFO</span>
        <span class="log-message">日志已清空</span>
      </div>
    `;
  }

  // 自动刷新
  startAutoRefresh() {
    this.refreshInterval = setInterval(() => {
      this.loadData();
    }, 30000); // 30秒刷新一次
  }

  // 工具函数
  formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  formatTime(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    return `${Math.floor(diff / 86400)}天前`;
  }
}

// 添加旋转动画
const style = document.createElement('style');
style.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(style);

// 初始化应用
const app = new RelayApp();
