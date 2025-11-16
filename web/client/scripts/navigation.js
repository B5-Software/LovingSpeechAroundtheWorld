/**
 * 导航系统 - 面板切换与历史管理
 */

let navigationGuard = null;

export function setNavigationGuard(fn) {
  navigationGuard = typeof fn === 'function' ? fn : null;
}

export class NavigationController {
  constructor() {
    this.panels = new Map();
    this.activePanel = 'home-panel';
    this.history = [];
    this.init();
  }

  init() {
    this.collectPanels();
    this.attachListeners();
    this.showPanel(this.activePanel);
  }

  collectPanels() {
    document.querySelectorAll('.panel').forEach((panel) => {
      this.panels.set(panel.id, panel);
    });
  }

  attachListeners() {
    document.querySelectorAll('[data-navigate]').forEach((trigger) => {
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = trigger.getAttribute('data-navigate');
        this.navigateTo(targetId);
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activePanel !== 'home-panel') {
        this.navigateTo('home-panel');
      }
      
      // Ctrl+L 打开启动器
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        this.navigateTo('panel-launcher');
      }
    });

    // Dock栏交互增强
    this.enhanceDockInteractions();
  }

  enhanceDockInteractions() {
    const dockItems = document.querySelectorAll('.dock-item');
    
    dockItems.forEach(item => {
      // 点击波纹效果
      item.addEventListener('click', (e) => {
        const ripple = document.createElement('div');
        ripple.style.cssText = `
          position: absolute;
          width: 100%;
          height: 100%;
          background: radial-gradient(circle, rgba(236, 72, 153, 0.5), transparent);
          border-radius: 50%;
          pointer-events: none;
          animation: ripple-out 0.6s ease-out;
          top: 0;
          left: 0;
        `;
        item.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      });
    });
  }

  navigateTo(panelId) {
    if (navigationGuard && navigationGuard(panelId) === false) {
      return;
    }
    if (!this.panels.has(panelId)) {
      console.warn(`面板 ${panelId} 不存在`);
      return;
    }

    if (this.activePanel !== 'home-panel') {
      this.history.push(this.activePanel);
    }

    this.showPanel(panelId);
  }

  showPanel(panelId) {
    this.panels.forEach((panel, id) => {
      if (id === panelId) {
        panel.classList.add('active');
        panel.style.display = panel.classList.contains('hero-panel') ? 'grid' : 'block';
      } else {
        panel.classList.remove('active');
        setTimeout(() => {
          if (!panel.classList.contains('active')) {
            panel.style.display = 'none';
          }
        }, 500);
      }
    });

    this.activePanel = panelId;
    const isHome = panelId === 'home-panel';
    document.body.classList.toggle('panel-home', isHome);
    document.body.classList.toggle('panel-active', !isHome);

    window.dispatchEvent(new CustomEvent('panel-changed', {
      detail: { panel: panelId, isHome }
    }));
  }

  getCurrentPanel() {
    return this.activePanel;
  }
}

export function initNavigation() {
  return new NavigationController();
}
