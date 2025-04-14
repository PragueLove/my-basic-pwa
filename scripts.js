// ==== 模块化封装 =====
class AuthManager {
  constructor(supabase) {
    this.supabase = supabase;
    this.initAuthListeners();
  }

  initAuthListeners() {
    // 监听认证状态变化
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN') {
        await this.handleUserSync(session.user);
        UI.toggleAuthUI(false);
      } else {
        UI.toggleAuthUI(true);
      }
    });
  }

  async handleUserSync(user) {
    // 同步用户数据到 public.users
    const { error } = await this.supabase.from('users').upsert({
      id: user.id,
      email: user.email,
      last_login: new Date().toISOString()
    }, { onConflict: 'id' });

    if (error) console.error('用户数据同步失败:', error);
  }

  async login(email, password) {
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
    
    if (error) throw error;
    if (!data.user?.email_confirmed_at) {
      throw new Error('请先验证邮箱！');
    }
    return data.user;
  }

  async register(email, password) {
    const { data, error } = await this.supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }
}

class Tracker {
  constructor(supabase) {
    this.supabase = supabase;
    this.positionBuffer = [];
    this.lastInsert = 0;
    this.BATCH_SIZE = 10;
    this.BATCH_INTERVAL = 15000; // 15秒

    this.state = {
      map: null,
      polyline: null,
      watchId: null,
      isTracking: false,
      startTime: null,
      totalDistance: 0,
      positions: []
    };
  }

  initMap() {
    this.state.map = L.map('map').setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(this.state.map);
    this.state.polyline = L.polyline([], { color: 'blue' }).addTo(this.state.map);
  }

  async start() {
    if (!('geolocation' in navigator)) {
      throw new Error('浏览器不支持地理位置跟踪');
    }

    this.state.isTracking = true;
    this.state.startTime = Date.now();
    UI.updateTrackingUI(true);

    // 请求位置权限
    const status = await navigator.permissions.query({ name: 'geolocation' });
    status.onchange = () => this.handlePermissionChange(status.state);

    this.state.watchId = navigator.geolocation.watchPosition(
      pos => this.handlePosition(pos),
      err => this.handleError(err),
      { enableHighAccuracy: true, maximumAge: 0 }
    );
  }

  stop() {
    if (this.state.watchId) {
      navigator.geolocation.clearWatch(this.state.watchId);
      this.state.watchId = null;
    }
    this.state.isTracking = false;
    UI.updateTrackingUI(false);
    this.flushBuffer(); // 强制刷新剩余数据
  }

  reset() {
    this.stop();
    this.state.polyline.setLatLngs([]);
    this.state.totalDistance = 0;
    this.state.positions = [];
    UI.resetMetrics();
  }

  handlePosition(position) {
    const newPoint = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: new Date(position.timestamp)
    };

    // 更新地图
    const latLng = [newPoint.lat, newPoint.lng];
    this.state.polyline.addLatLng(latLng);
    this.state.map.setView(latLng);

    // 计算距离
    if (this.state.positions.length > 0) {
      const prev = this.state.positions.slice(-1)[0];
      this.state.totalDistance += this.calculateDistance(prev, newPoint);
    }
    this.state.positions.push(newPoint);

    // 批量处理
    this.positionBuffer.push({
      ...newPoint,
      user_id: this.supabase.auth.user()?.id
    });

    if (this.positionBuffer.length >= this.BATCH_SIZE || 
        Date.now() - this.lastInsert > this.BATCH_INTERVAL) {
      this.flushBuffer();
    }

    UI.updateMetrics({
      distance: this.state.totalDistance,
      duration: Date.now() - this.state.startTime
    });
  }

  async flushBuffer() {
    if (this.positionBuffer.length === 0) return;

    const { error } = await this.supabase.from('positions')
      .insert(this.positionBuffer);

    if (!error) {
      this.positionBuffer = [];
      this.lastInsert = Date.now();
    }
  }

  calculateDistance(p1, p2) {
    const R = 6371e3; // 米
    const φ1 = p1.lat * Math.PI/180;
    const φ2 = p2.lat * Math.PI/180;
    const Δφ = (p2.lat - p1.lat) * Math.PI/180;
    const Δλ = (p2.lng - p1.lng) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  handlePermissionChange(state) {
    if (state !== 'granted') {
      this.stop();
      UI.showToast('位置权限已关闭，跟踪停止', 'error');
    }
  }

  handleError(error) {
    this.stop();
    UI.showToast(`地理位置错误: ${error.message}`, 'error');
  }
}

class UI {
  static elements = {
    authContainer: document.getElementById('auth-container'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    startButton: document.getElementById('startButton'),
    stopButton: document.getElementById('stopButton'),
    resetButton: document.getElementById('resetButton'),
    distance: document.getElementById('distance'),
    duration: document.getElementById('duration'),
    pace: document.getElementById('pace')
  };

  static toggleAuthUI(show) {
    this.elements.authContainer.style.display = show ? 'flex' : 'none';
    this.elements.startButton.disabled = show;
  }

  static updateTrackingUI(isTracking) {
    this.elements.startButton.disabled = isTracking;
    this.elements.stopButton.disabled = !isTracking;
    this.elements.resetButton.disabled = isTracking;
  }

  static updateMetrics({ distance, duration }) {
    this.elements.distance.textContent = (distance / 1000).toFixed(2); // 转为千米
    this.elements.duration.textContent = this.formatDuration(duration);
    this.elements.pace.textContent = this.calculatePace(distance, duration);
  }

  static resetMetrics() {
    this.elements.distance.textContent = '0.00';
    this.elements.duration.textContent = '00:00:00';
    this.elements.pace.textContent = '--:--';
  }

  static formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map(v => String(v).padStart(2, '0'))
      .join(':');
  }

  static calculatePace(distance, duration) {
    if (distance === 0) return '--:--';
    const paceMsPerKm = duration / (distance / 1000);
    const paceMinutes = Math.floor(paceMsPerKm / 60000);
    const paceSeconds = Math.floor((paceMsPerKm % 60000) / 1000);
    return `${String(paceMinutes).padStart(2, '0')}:${String(paceSeconds).padStart(2, '0')}`;
  }

  static showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }
}

// ==== 初始化流程 ====
document.addEventListener('DOMContentLoaded', async () => {
  // 初始化 Supabase
  const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_KEY
  );

  // 初始化模块
  const authManager = new AuthManager(supabase);
  const tracker = new Tracker(supabase);
  tracker.initMap();

  // 表单事件绑定
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await authManager.login(
        document.getElementById('login-email').value,
        document.getElementById('login-password').value
      );
    } catch (error) {
      UI.showToast(error.message, 'error');
    }
  });

  document.getElementById('register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm-password').value;


document.getElementById('register').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // 获取表单输入值
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  const confirmPassword = document.getElementById('register-confirm-password').value;

  try {
    // 1. 验证密码是否匹配
    if (password !== confirmPassword) {
      throw new Error('两次输入的密码不一致');
    }

    // 2. 密码复杂度验证
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
    if (!passwordRegex.test(password)) {
      throw new Error('密码需至少8位，包含字母和数字');
    }

    // 3. 调用Supabase注册
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.href // 邮箱验证后重定向到当前页面
      }
    });

    // 4. 处理注册结果
    if (error) throw error;
    
    // 显示成功提示
    UI.showToast('注册成功！请检查邮箱验证邮件', 'success');
    
    // 自动跳转到登录表单
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register').reset();

  } catch (error) {
    // 统一错误处理
    console.error('注册失败:', error);
    UI.showToast(`注册失败: ${error.message}`, 'error');
    
    // 高亮错误字段（可选）
    if (error.message.includes('密码')) {
      document.getElementById('register-password').classList.add('error-field');
      document.getElementById('register-confirm-password').classList.add('error-field');
    }
  }
});

    
    if (!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/.test(password)) {
      UI.showToast('密码需至少8位且包含字母和数字', 'error');
      return;
    }

    if (password !== confirm) {
      UI.showToast('两次密码输入不一致', 'error');
      return;
    }

    try {
      await authManager.register(
        document.getElementById('register-email').value,
        password
      );
      UI.showToast('注册成功，请检查邮箱验证！');
      document.getElementById('register').reset();
    } catch (error) {
      UI.showToast(error.message, 'error');
    }
  });

  // 按钮事件
  UI.elements.startButton.addEventListener('click', () => tracker.start());
  UI.elements.stopButton.addEventListener('click', () => tracker.stop());
  UI.elements.resetButton.addEventListener('click', () => tracker.reset());

  // 初始化 Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => console.log('SW registered:', reg))
      .catch(err => console.error('SW注册失败:', err));
  }
});
