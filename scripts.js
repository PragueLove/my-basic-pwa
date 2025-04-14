// ==== 模块化封装 =====

/**
 * 认证管理类 - 处理用户登录、注册和认证状态
 */
class AuthManager {
  constructor(supabase) {
    this.supabase = supabase;  // Supabase客户端实例
    this.initAuthListeners();  // 初始化认证状态监听
  }

  /**
   * 初始化认证状态变化监听
   */
  initAuthListeners() {
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      // 用户登录成功时处理
      if (event === 'SIGNED_IN') {
        await this.handleUserSync(session.user);  // 同步用户数据
        UI.toggleAuthUI(false);  // 隐藏认证界面
      } else {
        UI.toggleAuthUI(true);  // 显示认证界面
      }
    });
  }

  /**
   * 同步用户数据到公共表
   * @param {object} user - 用户对象
   */
  async handleUserSync(user) {
    if (!user) return;

    try {
      const { error } = await this.supabase
        .from('users')
        .upsert({
          id: user.id,
          email: user.email,
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'id'
        });

      if (error) {
        console.error('用户数据同步失败:', error);
        throw error;
      }
    } catch (error) {
      console.error('同步用户数据时出错:', error);
      throw error; // 向上传递错误
    }
  }

  /**
   * 用户登录方法
   * @param {string} email - 邮箱
   * @param {string} password - 密码
   */
  async login(email, password) {
    const { data, error } = await this.supabase.auth.signInWithPassword({ 
      email, 
      password 
    });
    
    if (error) throw error;
    
    // 检查邮箱是否已验证
    if (!data.user?.email_confirmed_at) {
      throw new Error('请先验证邮箱！');
    }

    // 登录成功后同步用户数据
    try {
      await this.handleUserSync(data.user);
    } catch (error) {
      console.error('用户数据同步失败:', error);
      // 不阻止登录流程，只记录错误
    }

    return data.user;
  }

  /**
   * 用户注册方法
   * @param {string} email - 邮箱
   * @param {string} password - 密码
   */
  async register(email, password) {
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: 'http://localhost:3000'  // 修改为本地开发环境URL
      }
    });

    if (error) throw error;

    // 如果注册成功，立即同步用户数据到 users 表
    if (data.user) {
      await this.handleUserSync(data.user);
    }

    return data;
  }

  /**
   * 重新发送验证邮件
   * @param {string} email - 用户邮箱
   */
  async resendVerificationEmail(email) {
    const { error } = await this.supabase.auth.resend({
      type: 'signup',
      email: email,
      options: {
        emailRedirectTo: 'http://localhost:3000'  // 修改为本地开发环境URL
      }
    });
    
    if (error) throw error;
    return { success: true };
  }
}

/**
 * 运动追踪类 - 处理地理位置跟踪和数据记录
 */
class Tracker {
  constructor(supabase) {
    this.supabase = supabase;  // Supabase客户端实例
    
    // 位置数据缓冲区配置
    this.positionBuffer = [];
    this.lastInsert = 0;
    this.BATCH_SIZE = 10;       // 批量插入阈值
    this.BATCH_INTERVAL = 15000; // 批量插入间隔（15秒）

    // 追踪状态管理
    this.state = {
      map: null,          // 地图实例
      polyline: null,     // 轨迹线实例
      watchId: null,      // 地理位置监听ID
      isTracking: false,  // 是否正在追踪
      startTime: null,    // 开始时间戳
      totalDistance: 0,   // 总距离（米）
      positions: []       // 位置点集合
    };
  }

  /**
   * 初始化地图
   */
  initMap() {
    // 使用伦敦坐标作为默认中心
    this.state.map = L.map('map').setView([51.505, -0.09], 13);
    
    // 添加OSM地图图层
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.state.map);

    // 初始化轨迹线
    this.state.polyline = L.polyline([], { color: 'blue' }).addTo(this.state.map);
  }

  /**
   * 开始追踪
   */
  async start() {
    // 检查地理位置支持
    if (!('geolocation' in navigator)) {
      throw new Error('浏览器不支持地理位置跟踪');
    }

    // 更新追踪状态
    this.state.isTracking = true;
    this.state.startTime = Date.now();
    UI.updateTrackingUI(true);

    // 请求位置权限
    const status = await navigator.permissions.query({ name: 'geolocation' });
    status.onchange = () => this.handlePermissionChange(status.state);

    // 启动位置监听
    this.state.watchId = navigator.geolocation.watchPosition(
      pos => this.handlePosition(pos),
      err => this.handleError(err),
      { 
        enableHighAccuracy: true,  // 高精度模式
        maximumAge: 0              // 不使用缓存位置
      }
    );
  }

  /**
   * 停止追踪
   */
  stop() {
    if (this.state.watchId) {
      navigator.geolocation.clearWatch(this.state.watchId);
      this.state.watchId = null;
    }
    this.state.isTracking = false;
    UI.updateTrackingUI(false);
    this.flushBuffer();  // 提交剩余数据
  }

  /**
   * 重置追踪数据
   */
  reset() {
    this.stop();
    this.state.polyline.setLatLngs([]);  // 清除轨迹线
    this.state.totalDistance = 0;
    this.state.positions = [];
    UI.resetMetrics();  // 重置UI数据
  }

  /**
   * 处理位置更新
   * @param {Position} position - 地理位置对象
   */
  handlePosition(position) {
    // 构造位置点对象
    const newPoint = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: new Date(position.timestamp)
    };

    // 更新地图显示
    const latLng = [newPoint.lat, newPoint.lng];
    this.state.polyline.addLatLng(latLng);
    this.state.map.setView(latLng);

    // 计算移动距离
    if (this.state.positions.length > 0) {
      const prev = this.state.positions.slice(-1)[0];
      this.state.totalDistance += this.calculateDistance(prev, newPoint);
    }
    this.state.positions.push(newPoint);

    // 缓存位置数据
    this.positionBuffer.push({
      ...newPoint,
      user_id: this.supabase.auth.user()?.id  // 关联用户ID
    });

    // 批量提交条件检查
    if (this.positionBuffer.length >= this.BATCH_SIZE || 
        Date.now() - this.lastInsert > this.BATCH_INTERVAL) {
      this.flushBuffer();
    }

    // 更新UI指标
    UI.updateMetrics({
      distance: this.state.totalDistance,
      duration: Date.now() - this.state.startTime
    });
  }

  /**
   * 提交缓存数据到数据库
   */
  async flushBuffer() {
    if (this.positionBuffer.length === 0) return;

    const { error } = await this.supabase.from('positions')
      .insert(this.positionBuffer);

    if (!error) {
      this.positionBuffer = [];
      this.lastInsert = Date.now();
    }
  }

  /**
   * 计算两点间距离（哈弗辛公式）
   * @param {object} p1 - 起点坐标
   * @param {object} p2 - 终点坐标
   */
  calculateDistance(p1, p2) {
    const R = 6371e3; // 地球半径（米）
    const φ1 = p1.lat * Math.PI/180;
    const φ2 = p2.lat * Math.PI/180;
    const Δφ = (p2.lat - p1.lat) * Math.PI/180;
    const Δλ = (p2.lng - p1.lng) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  /**
   * 处理位置权限变化
   * @param {string} state - 权限状态
   */
  handlePermissionChange(state) {
    if (state !== 'granted') {
      this.stop();
      UI.showToast('位置权限已关闭，跟踪停止', 'error');
    }
  }

  /**
   * 处理地理位置错误
   * @param {PositionError} error - 错误对象
   */
  handleError(error) {
    this.stop();
    UI.showToast(`地理位置错误: ${error.message}`, 'error');
  }
}

/**
 * UI管理类 - 处理界面更新和交互
 */
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
    pace: document.getElementById('pace'),
    status: document.getElementById('status')
  };

  /**
   * 切换认证界面显示状态
   * @param {boolean} show - 是否显示
   */
  static toggleAuthUI(show) {
    this.elements.authContainer.style.display = show ? 'flex' : 'none';
    this.elements.startButton.disabled = show;
  }

  /**
   * 更新追踪控制按钮状态
   * @param {boolean} isTracking - 是否正在追踪
   */
  static updateTrackingUI(isTracking) {
    this.elements.startButton.disabled = isTracking;
    this.elements.stopButton.disabled = !isTracking;
    this.elements.resetButton.disabled = isTracking;
  }

  /**
   * 更新运动指标显示
   * @param {object} metrics - 指标对象
   */
  static updateMetrics({ distance, duration }) {
    this.elements.distance.textContent = (distance / 1000).toFixed(2); // 转换为千米
    this.elements.duration.textContent = this.formatDuration(duration);
    this.elements.pace.textContent = this.calculatePace(distance, duration);
  }

  /**
   * 重置指标显示
   */
  static resetMetrics() {
    this.elements.distance.textContent = '0.00';
    this.elements.duration.textContent = '00:00:00';
    this.elements.pace.textContent = '--:--';
  }

  /**
   * 格式化持续时间
   * @param {number} ms - 毫秒数
   */
  static formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map(v => String(v).padStart(2, '0'))
      .join(':');
  }

  /**
   * 计算配速
   * @param {number} distance - 距离（米）
   * @param {number} duration - 时间（毫秒）
   */
  static calculatePace(distance, duration) {
    if (distance === 0) return '--:--';
    const paceMsPerKm = duration / (distance / 1000);
    const paceMinutes = Math.floor(paceMsPerKm / 60000);
    const paceSeconds = Math.floor((paceMsPerKm % 60000) / 1000);
    return `${String(paceMinutes).padStart(2, '0')}:${String(paceSeconds).padStart(2, '0')}`;
  }

  /**
   * 显示提示信息
   * @param {string} message - 提示内容
   * @param {string} type - 类型（info/error/success）
   */
  static showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);  // 5秒后自动移除
  }

  /**
   * 显示加载状态
   * @param {HTMLButtonElement} button - 按钮元素
   * @param {boolean} loading - 是否显示加载状态
   */
  static setLoading(button, loading) {
    if (!button) return;
    
    if (loading) {
      // 保存原始文本
      if (!button.getAttribute('data-original-text')) {
        button.setAttribute('data-original-text', button.textContent);
      }
      button.disabled = true;
      button.classList.add('loading');
      button.textContent = '处理中...';
    } else {
      button.disabled = false;
      button.classList.remove('loading');
      button.textContent = button.getAttribute('data-original-text') || button.textContent;
    }
  }

  /**
   * 显示错误消息
   * @param {string} message - 错误信息
   */
  static showError(message) {
    const toast = document.createElement('div');
    toast.className = 'toast error';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }
}

// ==== 初始化流程 ====
document.addEventListener('DOMContentLoaded', async () => {
  // 初始化Supabase客户端
  const supabaseUrl = 'https://ebyyrppkpxpfchmbwfxz.supabase.co';  // 替换为您的 Supabase URL
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVieXlycHBrcHhwZmNobWJ3Znh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ1OTk2MTUsImV4cCI6MjA2MDE3NTYxNX0.hbB3tN7XvcIcRch1FpEMB3H4wEXy4wz9NNca3inQ5MA';  // 替换为您的 Supabase anon key
  
  const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

  // 初始化功能模块
  const authManager = new AuthManager(supabase);
  const tracker = new Tracker(supabase);
  tracker.initMap();

  // 保存按钮原始文本
  document.querySelectorAll('button').forEach(button => {
    button.setAttribute('data-original-text', button.textContent);
  });

  // 注册表单提交处理
  document.getElementById('register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    
    try {
      UI.setLoading(submitButton, true);

      const email = document.getElementById('register-email').value;
      const password = document.getElementById('register-password').value;
      const confirmPassword = document.getElementById('register-confirm-password').value;

      // 表单验证
      if (!email || !password || !confirmPassword) {
        throw new Error('请填写所有必填字段');
      }

      if (password !== confirmPassword) {
        throw new Error('两次输入的密码不一致');
      }

      if (password.length < 8) {
        throw new Error('密码长度至少为8位');
      }

      // 执行注册
      const result = await authManager.register(email, password);
      
      if (result.data?.user) {
        // 注册成功提示
        UI.showToast('注册成功！请检查邮箱完成验证', 'success');
        
        // 切换到登录表单
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('login-form').style.display = 'block';
        
        // 重置表单
        form.reset();
      } else {
        throw new Error('注册失败，请重试');
      }
    } catch (error) {
      console.error('注册失败:', error);
      UI.showError(error.message);
    } finally {
      UI.setLoading(submitButton, false);
    }
  });

  // 登录表单提交处理
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitButton = e.target.querySelector('button[type="submit"]');
    UI.setLoading(submitButton, true);

    try {
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;

      await authManager.login(email, password);
      UI.showToast('登录成功！', 'success');
    } catch (error) {
      console.error('登录失败:', error);
      UI.showError(error.message);
    } finally {
      UI.setLoading(submitButton, false);
    }
  });

  // 表单切换处理
  document.getElementById('show-register').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
  });

  document.getElementById('show-login').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register-form').style.display = 'none';
  });

  // 重新发送验证邮件
  document.getElementById('resend-verification').addEventListener('click', async (e) => {
    e.preventDefault();
    const button = e.target;
    UI.setLoading(button, true);

    try {
      const email = document.getElementById('register-email').value;
      if (!email) {
        throw new Error('请输入邮箱地址');
      }
      await authManager.resendVerificationEmail(email);
      UI.showToast('验证邮件已重新发送，请查收', 'success');
    } catch (error) {
      console.error('发送失败:', error);
      UI.showError(error.message);
    } finally {
      UI.setLoading(button, false);
    }
  });

  // 绑定控制按钮事件
  UI.elements.startButton.addEventListener('click', () => tracker.start());
  UI.elements.stopButton.addEventListener('click', () => tracker.stop());
  UI.elements.resetButton.addEventListener('click', () => tracker.reset());

  // 注册Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => console.log('Service Worker注册成功:', reg))
      .catch(err => console.error('Service Worker注册失败:', err));
  }
});
