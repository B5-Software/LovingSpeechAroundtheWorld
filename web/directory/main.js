// Directory Authority Main Script

class DirectoryApp {
  constructor() {
    this.theme = localStorage.getItem('directory-theme') || 'dark';
    this.refreshInterval = null;
    this.allRelays = [];
    this.relayLookup = new Map();
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
    localStorage.setItem('directory-theme', this.theme);
    this.applyTheme();
  }

  // 绑定事件
  bindEvents() {
    document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());
    document.getElementById('refresh-btn').addEventListener('click', () => this.loadData());
    document.getElementById('sync-chain-btn').addEventListener('click', () => this.syncChain());
    document.getElementById('relay-search').addEventListener('input', (e) => this.filterRelays(e.target.value));
    
    // 使用事件委托处理中继详情按钮
    document.addEventListener('click', (event) => {
      const btn = event.target.closest('.relay-view-btn');
      if (btn) {
        event.preventDefault();
        const relayKey = btn.dataset.relayKey;
        if (relayKey) {
          this.viewRelay(relayKey);
        }
      }
    });
    
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
        this.loadBlockchain(),
        this.loadRelays(),
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
      const response = await fetch('/api/directory/stats');
      const data = await response.json();
      
      document.getElementById('stat-blocks').textContent = data.blockHeight || 0;
      document.getElementById('stat-relays').textContent = data.activeRelays || 0;
      document.getElementById('stat-health').textContent = (data.networkHealth || 100) + '%';
      document.getElementById('stat-uptime').textContent = this.formatUptime(data.uptime || 0);
    } catch (error) {
      console.error('加载统计失败:', error);
    }
  }

  // 加载区块链数据
  async loadBlockchain() {
    try {
      const response = await fetch('/api/directory/blockchain');
      const data = await response.json();
      
      document.getElementById('genesis-hash').textContent = data.genesisHash || '—';
      document.getElementById('latest-hash').textContent = data.latestHash || '—';
      document.getElementById('total-letters').textContent = data.totalLetters || 0;
      document.getElementById('chain-size').textContent = this.formatSize(data.chainSize || 0);
    } catch (error) {
      console.error('加载区块链失败:', error);
    }
  }

  // 加载中继列表
  async loadRelays() {
    try {
      const response = await fetch('/api/directory/relays');
      const payload = await response.json();
      const relays = Array.isArray(payload?.relays) ? payload.relays : [];
      
      const tbody = document.getElementById('relay-tbody');
      
      if (!relays.length) {
        tbody.innerHTML = `
          <tr class="empty-row">
            <td colspan="8">
              <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>暂无中继节点注册</p>
              </div>
            </td>
          </tr>
        `;
        return;
      }
      
      this.allRelays = relays;
      this.relayLookup = new Map();
      
      tbody.innerHTML = relays.map((relay) => {
        const relayKey = this.buildRelayKey(relay);
        this.relayLookup.set(relayKey, relay);
        const forwardedAddress = relay.forwardedAddress
          || this.pickForwardedAddress(relay.connectionMeta?.forwardedChain);
        const forwardedPort = relay.connectionMeta?.forwardedPort || relay.connectionMeta?.clientPort || '';
        const forwardedProtocol = (relay.connectionMeta?.clientProtocol || relay.connectionMeta?.forwardedProto || 'http').toLowerCase();
        const forwardedUrl = relay.forwardedUrl
          || this.buildForwardedUrl(forwardedAddress, forwardedPort, forwardedProtocol);
        const relayAddress = forwardedUrl
          || (forwardedAddress
            ? `${forwardedAddress}${forwardedPort ? `:${forwardedPort}` : ''}`
            : relay.clientDerivedUrl
              || relay.connectionMeta?.clientDerivedUrl
              || relay.resolvedPublicUrl
              || relay.publicUrl
              || relay.onion
              || relay.id)
          || '未提供';
        const reportedAddress = relay.reportedPublicUrl && relay.reportedPublicUrl !== relayAddress
          ? relay.reportedPublicUrl
          : null;
        const reputation = typeof relay.reputation === 'number'
          ? relay.reputation
          : Math.round((relay.reachability || 0) * 100);
        const latency = typeof relay.latencyMs === 'number'
          ? relay.latencyMs
          : (typeof relay.latency === 'number' ? relay.latency : '—');
        const fingerprintShort = (relay.fingerprint || '未知').substring(0, 16);
        const nickname = relay.nickname || relayAddress;
        const lastHeartbeat = relay.lastHeartbeat || relay.lastSeen;
        const isOnline = relay.isOnline ?? Boolean(relay.lastSeen);
        const addressCell = reportedAddress
          ? `<code class="mono" title="原始上报: ${reportedAddress}">${relayAddress}</code>`
          : `<code class="mono">${relayAddress}</code>`;
        
        return `
          <tr data-relay-key="${relayKey}">
            <td>
              <span class="badge ${isOnline ? 'online' : 'offline'}">
                <i class="fas fa-${isOnline ? 'check-circle' : 'times-circle'}"></i>
                ${isOnline ? '在线' : '离线'}
              </span>
            </td>
            <td><strong>${nickname}</strong></td>
            <td>${addressCell}</td>
            <td><code class="mono">${fingerprintShort}...</code></td>
            <td>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 60px; height: 6px; background: var(--bg-panel); border-radius: 3px; overflow: hidden;">
                  <div style="width: ${Math.min(Math.max(reputation, 0), 100)}%; height: 100%; background: linear-gradient(90deg, var(--primary), var(--secondary));"></div>
                </div>
                <span>${reputation}%</span>
              </div>
            </td>
            <td>${this.formatTime(lastHeartbeat)}</td>
            <td>${latency === '—' ? '—' : `${latency}ms`}</td>
            <td>
              <button class="btn-icon-only relay-view-btn" type="button" data-relay-key="${relayKey}" title="查看详情">
                <i class="fas fa-eye"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (error) {
      console.error('加载中继失败:', error);
    }
  }

  // 加载Tor状态
  async loadTorStatus() {
    try {
      const response = await fetch('/api/directory/tor/status');
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

  // 同步区块链
  async syncChain() {
    try {
      const btn = document.getElementById('sync-chain-btn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>同步中...</span>';
      
      const response = await fetch('/api/directory/blockchain/sync', { method: 'POST' });
      const result = await response.json();
      
      this.addLog('success', `区块链同步完成，当前高度: ${result.height}`);
      await this.loadBlockchain();
      
    } catch (error) {
      this.addLog('error', `同步失败: ${error.message}`);
    } finally {
      const btn = document.getElementById('sync-chain-btn');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-cloud-download-alt"></i><span>同步链</span>';
    }
  }

  // 过滤中继
  filterRelays(query) {
    const rows = document.querySelectorAll('#relay-tbody tr[data-relay-key]');
    const lowerQuery = query.toLowerCase();
    
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(lowerQuery) ? '' : 'none';
    });
  }

  // Tor配置
  async saveTorConfig(formData) {
    try {
      const config = {
        torPath: formData.get('torPath'),
        hiddenServicePort: parseInt(formData.get('hiddenServicePort'))
      };
      
      const response = await fetch('/api/directory/tor/config', {
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
      
      const response = await fetch('/api/directory/tor/start', { method: 'POST' });
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
      const response = await fetch('/api/directory/tor/stop', { method: 'POST' });
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

  // 查看中继详情
  viewRelay(relayKey) {
    const relay = this.relayLookup?.get(relayKey) || this.allRelays?.find((item) => this.buildRelayKey(item) === relayKey);
    if (!relay) {
      this.addLog('error', `未找到中继详情: ${relayKey}`);
      return;
    }

    const forwardedAddress = relay.forwardedAddress
      || this.pickForwardedAddress(relay.connectionMeta?.forwardedChain);
    const forwardedPort = relay.connectionMeta?.forwardedPort || relay.connectionMeta?.clientPort || '';
    const forwardedProtocol = (relay.connectionMeta?.clientProtocol || relay.connectionMeta?.forwardedProto || 'http').toLowerCase();
    const forwardedDisplay = relay.forwardedUrl
      || this.buildForwardedUrl(forwardedAddress, forwardedPort, forwardedProtocol)
      || (forwardedAddress ? `${forwardedAddress}${forwardedPort ? `:${forwardedPort}` : ''}` : null);
    const latencyLabel = typeof relay.latencyMs === 'number'
      ? `${relay.latencyMs}ms`
      : (typeof relay.latency === 'number' ? `${relay.latency}ms` : '未知');
    const reachabilityLabel = `${Math.round((relay.reachability || 0) * 100)}%`;
    const metricsSampled = this.formatTime(relay.metricsSampledAt);
    const metricsSource = relay.metricsSource || '目录探测';
    const metricsError = relay.metricsError ? `<br>异常: ${relay.metricsError}` : '';
    const metricsNotes = relay.metricsNotes ? `<br>备注: ${relay.metricsNotes}` : '';

    const chainInfo = relay.chainSummary
      ? `区块高度: ${relay.chainSummary.length || 0}<br>最新哈希: <code class="mono">${(relay.chainSummary.latestHash || '—').substring(0, 48)}...</code>`
      : '暂无链路数据';

    const metrics = `
      <strong>网络指标</strong><br>
      延迟: ${latencyLabel}<br>
      可达性: ${reachabilityLabel}<br>
      GFW屏蔽: ${relay.gfwBlocked ? '是' : '否'}<br>
      最近采样: ${metricsSampled}<br>
      数据来源: ${metricsSource}
      ${metricsError}
      ${metricsNotes}
    `;

    const connectionDetails = relay.connectionMeta
      ? `
        <strong>连接来源</strong><br>
        最近上报: ${this.formatTime(relay.connectionMeta.resolvedAt)}<br>
        客户端IP: ${relay.lastSeenIp || relay.connectionMeta.clientAddress || '未知'}<br>
        客户端端口: ${relay.connectionMeta.clientPort || '未知'}<br>
        客户端协议: ${(relay.connectionMeta.clientProtocol || relay.connectionMeta.forwardedProto || 'http').toUpperCase()}<br>
        转发链: ${this.formatForwardedChain(relay.connectionMeta.forwardedChain)}<br>
        声称URL: <code class="mono">${relay.reportedPublicUrl || relay.connectionMeta.reportedPublicUrl || '—'}</code><br>
        解析URL: <code class="mono">${forwardedDisplay || relay.clientDerivedUrl || relay.connectionMeta.clientDerivedUrl || relay.resolvedPublicUrl || relay.connectionMeta.resolvedPublicUrl || relay.publicUrl || '—'}</code>
      `
      : '暂未记录连接来源';

    const modal = document.createElement('div');
    modal.className = 'relay-modal';
    modal.innerHTML = `
      <div class="modal-overlay" tabindex="-1"></div>
      <div class="modal-content" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3><i class="fas fa-server"></i> ${relay.nickname || '中继详情'}</h3>
          <button class="modal-close" type="button">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="detail-grid">
            <div class="detail-item">
              <label>昵称</label>
              <span>${relay.nickname || '未设置'}</span>
            </div>
            <div class="detail-item">
              <label>状态</label>
              <span class="badge ${relay.isOnline ? 'online' : 'offline'}">${relay.isOnline ? '在线' : '离线'}</span>
            </div>
            <div class="detail-item full">
              <label>地址</label>
              <code class="mono">${forwardedDisplay || relay.clientDerivedUrl || relay.connectionMeta?.clientDerivedUrl || relay.resolvedPublicUrl || relay.publicUrl || relay.onion || relay.id}</code>
            </div>
            <div class="detail-item full">
              <label>指纹</label>
              <code class="mono">${relay.fingerprint || '未知'}</code>
            </div>
            <div class="detail-item">
              <label>首次注册</label>
              <span>${this.formatTime(relay.createdAt)}</span>
            </div>
            <div class="detail-item">
              <label>最后心跳</label>
              <span>${this.formatTime(relay.lastSeen || relay.lastHeartbeat)}</span>
            </div>
            <div class="detail-item full">
              <label>区块链</label>
              <div>${chainInfo}</div>
            </div>
            <div class="detail-item full">
              <label>性能指标</label>
              <div>${metrics}</div>
            </div>
            <div class="detail-item full">
              <label>连接信息</label>
              <div>${connectionDetails}</div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" type="button">
            <i class="fas fa-times"></i> 关闭
          </button>
        </div>
      </div>
    `;

    const closeModal = () => modal.remove();
    modal.querySelector('.modal-overlay').addEventListener('click', closeModal);
    modal.querySelector('.modal-close').addEventListener('click', closeModal);
    modal.querySelector('.modal-footer .btn').addEventListener('click', closeModal);
    document.addEventListener('keydown', (evt) => {
      if (evt.key === 'Escape') {
        closeModal();
      }
    }, { once: true });

    document.body.appendChild(modal);
    this.addLog('info', `查看中继详情: ${relay.nickname || relayKey}`);
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
  buildRelayKey(relay) {
    return String(
      relay?.forwardedUrl
      || relay?.forwardedAddress
      || relay?.resolvedPublicUrl
      || relay?.publicUrl
      || relay?.onion
      || relay?.id
      || relay?.fingerprint
      || 'relay'
    );
  }

  pickForwardedAddress(chain) {
    if (!Array.isArray(chain) || !chain.length) {
      return null;
    }
    const cleaned = chain
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
    const ipv4 = cleaned.find((entry) => entry && entry.includes('.') && !entry.includes(':'));
    return ipv4 || cleaned[0] || null;
  }

  formatForwardedChain(chain) {
    if (!Array.isArray(chain) || !chain.length) {
      return '—';
    }
    return chain.map((entry) => entry || '未知').join(' → ');
  }

  ensureBracketedHost(host) {
    if (!host) return null;
    // Only wrap IPv6 addresses in brackets
    if (host.includes(':') && !host.startsWith('[')) {
      return `[${host}]`;
    }
    return host;
  }

  buildForwardedUrl(address, port, protocol = 'http') {
    if (!address) return null;
    const safeProto = protocol?.toLowerCase().replace(/:$/, '') || 'http';
    // Only bracket IPv6, leave IPv4 as-is
    const isIPv6 = address.includes(':');
    const hostPart = isIPv6 ? this.ensureBracketedHost(address) : address;
    const normalizedPort = port ? String(port).trim() : '';
    const portSegment = normalizedPort ? `:${normalizedPort}` : '';
    return `${safeProto}://${hostPart}${portSegment}`;
  }

  formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    return hours > 0 ? `${hours}h` : '<1h';
  }

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
const app = new DirectoryApp();
window.directoryApp = app;
