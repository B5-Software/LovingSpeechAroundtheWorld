/**
 * 星河动画引擎 - 粒子场、流星与诗句轮播
 */

export class ParticleField {
  constructor(containerId = 'particle-canvas') {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.particleCount = 60;
    
    this.init();
  }

  init() {
    this.container.appendChild(this.canvas);
    this.resize();
    this.createParticles();
    this.animate();
    
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  createParticles() {
    const colors = [
      'rgba(236, 72, 153,',   // rose
      'rgba(125, 211, 252,',  // sky blue
      'rgba(167, 139, 250,',  // violet
      'rgba(251, 191, 36,'    // gold
    ];

    for (let i = 0; i < this.particleCount; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        size: Math.random() * 2.5 + 0.5,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: (Math.random() - 0.5) * 0.3,
        opacity: Math.random() * 0.5 + 0.2,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
  }

  animate() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    this.particles.forEach((particle) => {
      particle.x += particle.speedX;
      particle.y += particle.speedY;

      if (particle.x < 0 || particle.x > this.canvas.width) particle.speedX *= -1;
      if (particle.y < 0 || particle.y > this.canvas.height) particle.speedY *= -1;

      this.ctx.beginPath();
      this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      this.ctx.fillStyle = particle.color + particle.opacity + ')';
      this.ctx.fill();

      // 连线效果
      this.particles.forEach((other) => {
        const dx = particle.x - other.x;
        const dy = particle.y - other.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 100) {
          this.ctx.beginPath();
          this.ctx.strokeStyle = `rgba(236, 72, 153, ${0.1 * (1 - distance / 100)})`;
          this.ctx.lineWidth = 0.5;
          this.ctx.moveTo(particle.x, particle.y);
          this.ctx.lineTo(other.x, other.y);
          this.ctx.stroke();
        }
      });
    });

    requestAnimationFrame(() => this.animate());
  }
}

export class ShootingStarEffect {
  constructor(containerId = 'shooting-stars') {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    
    this.createStar();
    setInterval(() => this.createStar(), 4000);
  }

  createStar() {
    const star = document.createElement('div');
    star.className = 'shooting-star';
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 50}%`;
    star.style.animationDelay = `${Math.random() * 0.5}s`;
    
    this.container.appendChild(star);
    
    setTimeout(() => star.remove(), 2500);
  }
}

export class PoetryCarousel {
  constructor(elementId = 'poetry-carousel') {
    this.element = document.getElementById(elementId);
    if (!this.element) return;

    this.verses = [
      '以密钥为笔，将心声镌刻于区块之上',
      '让情书乘着 Tor 的暗流，穿越防火墙的重重封锁',
      '每一封信都是一颗星，散落在去中心化的银河',
      '用 RSA 的魔法守护秘密，用哈希链编织永恒',
      '在洋葱路由的迷宫中，爱意永远找得到归途',
      '数字签名是誓言，时间戳是见证',
      '从中继到中继，情书如候鸟迁徙',
      '加密是温柔的盔甲，解密是期待的钥匙'
    ];

    this.currentIndex = 0;
    this.start();
  }

  start() {
    this.show();
    setInterval(() => this.next(), 6000);
  }

  show() {
    if (!this.element) return;
    this.element.style.opacity = '0';
    
    setTimeout(() => {
      this.element.textContent = this.verses[this.currentIndex];
      this.element.style.opacity = '1';
    }, 400);
  }

  next() {
    this.currentIndex = (this.currentIndex + 1) % this.verses.length;
    this.show();
  }
}

export function initAnimations() {
  const particles = new ParticleField();
  const stars = new ShootingStarEffect();
  const poetry = new PoetryCarousel();
  
  return { particles, stars, poetry };
}
