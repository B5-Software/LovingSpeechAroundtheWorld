/**
 * 设置系统 - 主题与个性化配置
 */

// 默认设置
const defaultSettings = {
  theme: 'cyberpunk',
  mode: 'dark',
  particles: true,
  shootingStars: true,
  aurora: true,
  glass: true,
  animationSpeed: 1
};

const lightModeVariables = {
  '--deep-night': '#f8fafc',
  '--midnight-blue': '#f1f5f9',
  '--soft-white': '#0f172a',
  '--muted-gray': '#475569',
  '--glass-light': 'rgba(0, 0, 0, 0.05)',
  '--glass-medium': 'rgba(0, 0, 0, 0.12)',
  '--glass-dark': 'rgba(0, 0, 0, 0.4)'
};

// 主题配置
const themes = {
  aurora: {
    primary: '#ec4899',
    secondary: '#a78bfa',
    accent: '#7dd3fc',
    background: '#0a0e1a',
    surface: '#0f172a'
  },
  cyberpunk: {
    primary: '#ff0080',
    secondary: '#00ffff',
    accent: '#ffff00',
    background: '#0a0014',
    surface: '#1a0028'
  },
  forest: {
    primary: '#10b981',
    secondary: '#34d399',
    accent: '#6ee7b7',
    background: '#064e3b',
    surface: '#065f46'
  },
  ocean: {
    primary: '#0ea5e9',
    secondary: '#38bdf8',
    accent: '#7dd3fc',
    background: '#082f49',
    surface: '#0c4a6e'
  },
  sunset: {
    primary: '#f97316',
    secondary: '#fb923c',
    accent: '#fbbf24',
    background: '#431407',
    surface: '#7c2d12'
  },
  monochrome: {
    primary: '#e5e7eb',
    secondary: '#9ca3af',
    accent: '#6b7280',
    background: '#111827',
    surface: '#1f2937'
  }
};

export class SettingsManager {
  constructor() {
    this.settings = this.loadSettings();
    this.init();
  }

  init() {
    this.applySettings();
    this.attachListeners();
  }

  loadSettings() {
    try {
      const saved = localStorage.getItem('lovingspech-settings');
      return saved ? { ...defaultSettings, ...JSON.parse(saved) } : { ...defaultSettings };
    } catch {
      return { ...defaultSettings };
    }
  }

  saveSettings() {
    try {
      localStorage.setItem('lovingspeech-settings', JSON.stringify(this.settings));
    } catch (e) {
      console.error('设置保存失败:', e);
    }
  }

  applySettings() {
    this.applyTheme();
    this.applyMode();
    this.applyVisualEffects();
    this.updateUI();
  }

  applyTheme() {
    const theme = themes[this.settings.theme];
    if (!theme) return;

    const root = document.documentElement;
    root.style.setProperty('--rose-dawn', theme.primary);
    root.style.setProperty('--sky-whisper', theme.accent);
    root.style.setProperty('--violet-dream', theme.secondary);
    root.style.setProperty('--deep-night', theme.background);
    root.style.setProperty('--midnight-blue', theme.surface);

    document.body.setAttribute('data-theme', this.settings.theme);
  }

  applyMode() {
    let mode = this.settings.mode;
    
    if (mode === 'auto') {
      mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    document.body.setAttribute('data-mode', mode);

    const rootStyle = document.documentElement.style;
    if (mode === 'light') {
      Object.entries(lightModeVariables).forEach(([name, value]) => {
        rootStyle.setProperty(name, value);
      });
    } else {
      Object.keys(lightModeVariables).forEach((name) => {
        rootStyle.removeProperty(name);
      });
    }
  }

  applyVisualEffects() {
    const particleCanvas = document.getElementById('particle-canvas');
    const shootingStars = document.getElementById('shooting-stars');
    const auroraGradient = document.querySelector('.aurora-gradient');

    if (particleCanvas) {
      particleCanvas.style.display = this.settings.particles ? 'block' : 'none';
    }
    if (shootingStars) {
      shootingStars.style.display = this.settings.shootingStars ? 'block' : 'none';
    }
    if (auroraGradient) {
      auroraGradient.style.display = this.settings.aurora ? 'block' : 'none';
    }

    // 动画速度
    document.documentElement.style.setProperty('--animation-speed-multiplier', this.settings.animationSpeed);

    // 玻璃态效果
    if (!this.settings.glass) {
      document.documentElement.style.setProperty('--glass-light', 'rgba(15, 23, 42, 0.8)');
      document.documentElement.style.setProperty('--glass-medium', 'rgba(15, 23, 42, 0.9)');
    }
  }

  updateUI() {
    // 更新主题卡片选中状态
    document.querySelectorAll('.theme-card').forEach(card => {
      const theme = card.getAttribute('data-theme');
      card.classList.toggle('active', theme === this.settings.theme);
    });

    // 更新模式按钮选中状态
    document.querySelectorAll('.mode-btn').forEach(btn => {
      const mode = btn.getAttribute('data-mode');
      btn.classList.toggle('active', mode === this.settings.mode);
    });

    // 更新开关状态
    const toggles = {
      'toggle-particles': this.settings.particles,
      'toggle-shooting-stars': this.settings.shootingStars,
      'toggle-aurora': this.settings.aurora,
      'toggle-glass': this.settings.glass
    };

    Object.entries(toggles).forEach(([id, checked]) => {
      const toggle = document.getElementById(id);
      if (toggle) toggle.checked = checked;
    });

    // 更新动画速度选择器
    const speedSelect = document.getElementById('animation-speed');
    if (speedSelect) speedSelect.value = this.settings.animationSpeed;
  }

  attachListeners() {
    // 主题选择
    document.querySelectorAll('.theme-card').forEach(card => {
      card.addEventListener('click', () => {
        this.settings.theme = card.getAttribute('data-theme');
        this.saveSettings();
        this.applySettings();
      });
    });

    // 模式选择
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.settings.mode = btn.getAttribute('data-mode');
        this.saveSettings();
        this.applySettings();
      });
    });

    // 视觉效果开关
    const toggleHandlers = {
      'toggle-particles': 'particles',
      'toggle-shooting-stars': 'shootingStars',
      'toggle-aurora': 'aurora',
      'toggle-glass': 'glass'
    };

    Object.entries(toggleHandlers).forEach(([id, key]) => {
      const toggle = document.getElementById(id);
      if (toggle) {
        toggle.addEventListener('change', () => {
          this.settings[key] = toggle.checked;
          this.saveSettings();
          this.applySettings();
        });
      }
    });

    // 动画速度
    const speedSelect = document.getElementById('animation-speed');
    if (speedSelect) {
      speedSelect.addEventListener('change', () => {
        this.settings.animationSpeed = parseFloat(speedSelect.value);
        this.saveSettings();
        this.applySettings();
      });
    }

    // 重置设置
    const resetBtn = document.getElementById('reset-settings-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('确定要恢复默认设置吗?')) {
          this.settings = { ...defaultSettings };
          this.saveSettings();
          this.applySettings();
        }
      });
    }

    // 导出设置
    const exportBtn = document.getElementById('export-settings-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const dataStr = JSON.stringify(this.settings, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'lovingspeech-settings.json';
        link.click();
        URL.revokeObjectURL(url);
      });
    }

    // 导入设置
    const importBtn = document.getElementById('import-settings-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = (e) => {
          const file = e.target.files[0];
          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              const imported = JSON.parse(event.target.result);
              this.settings = { ...defaultSettings, ...imported };
              this.saveSettings();
              this.applySettings();
              alert('设置导入成功!');
            } catch {
              alert('设置导入失败,文件格式错误');
            }
          };
          reader.readAsText(file);
        };
        input.click();
      });
    }
  }
}

export function initSettings() {
  return new SettingsManager();
}
