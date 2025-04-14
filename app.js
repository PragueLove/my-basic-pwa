import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_CONFIG } from './config.js';

// 运动追踪类
class Tracker {
  constructor(supabase) {
    this.supabase = supabase;
    
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
      positions: [],      // 位置点集合
      currentSessionId: null // 当前会话ID
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

    // 创建新的运动会话
    const { data: session, error } = await this.supabase
      .from('sessions')
      .insert({
        user_id: this.supabase.auth.user()?.id,
        start_time: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    this.state.currentSessionId = session.id;

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
  async stop() {
    if (this.state.watchId) {
      navigator.geolocation.clearWatch(this.state.watchId);
      this.state.watchId = null;
    }
    this.state.isTracking = false;
    UI.updateTrackingUI(false);
    await this.flushBuffer();  // 提交剩余数据

    // 更新会话结束时间和统计数据
    if (this.state.currentSessionId) {
      const { error } = await this.supabase
        .from('sessions')
        .update({
          end_time: new Date().toISOString(),
          distance: this.state.totalDistance,
          duration: Date.now() - this.state.startTime
        })
        .eq('id', this.state.currentSessionId);

      if (error) console.error('更新会话失败:', error);
    }
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
      user_id: this.supabase.auth.user()?.id,  // 关联用户ID
      session_id: this.state.currentSessionId  // 关联会话ID
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

  /**
   * 加载历史记录
   */
  async loadHistory() {
    const { data: sessions, error } = await this.supabase
      .from('sessions')
      .select('*')
      .order('start_time', { ascending: false })
      .limit(10);

    if (error) throw error;
    return sessions;
  }

  /**
   * 加载特定会话的轨迹
   */
  async loadSessionTrack(sessionId) {
    const { data: positions, error } = await this.supabase
      .from('positions')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true });

    if (error) throw error;
    return positions;
  }
}

// UI管理类
class UI {
  static elements = {
    startButton: document.getElementById('startButton'),
    stopButton: document.getElementById('stopButton'),
    resetButton: document.getElementById('resetButton'),
    logoutButton: document.getElementById('logout'),
    distance: document.getElementById('distance'),
    duration: document.getElementById('duration'),
    pace: document.getElementById('pace'),
    status: document.getElementById('status')
  };

  /**
   * 更新追踪控制按钮状态
   * @param {boolean} isTracking - 是否正在追踪
   */
  static updateTrackingUI(isTracking) {
    this.elements.startButton.disabled = isTracking;
    this.elements.stopButton.disabled = !isTracking;
    this.elements.resetButton.disabled = isTracking;
    this.elements.status.textContent = isTracking ? 'Tracking' : 'Idle';
  }

  /**
   * 更新运动指标显示
   * @param {object} metrics - 指标对象
   */
  static updateMetrics({ distance, duration }) {
    this.elements.distance.textContent = (distance / 1000).toFixed(2) + ' km';
    this.elements.duration.textContent = this.formatDuration(duration);
    this.elements.pace.textContent = this.calculatePace(distance, duration) + ' /km';
  }

  /**
   * 重置指标显示
   */
  static resetMetrics() {
    this.elements.distance.textContent = '0.00 km';
    this.elements.duration.textContent = '00:00:00';
    this.elements.pace.textContent = '--:-- /km';
    this.elements.status.textContent = 'Idle';
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
    setTimeout(() => toast.remove(), 5000);
  }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 创建 Supabase 客户端实例
    const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    
    // 检查认证状态
    const { data: { session }, error } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = './index.html';
      return;
    }

    // 创建追踪器实例
    const tracker = new Tracker(supabase);
    
    // 初始化地图
    tracker.initMap();

    // 绑定按钮事件
    document.getElementById('startButton').addEventListener('click', () => tracker.start());
    document.getElementById('stopButton').addEventListener('click', () => tracker.stop());
    document.getElementById('resetButton').addEventListener('click', () => tracker.reset());

    // 登出按钮事件
    document.getElementById('logout').addEventListener('click', async () => {
      try {
        await supabase.auth.signOut();
        window.location.href = './index.html';
      } catch (error) {
        UI.showToast('登出失败: ' + error.message, 'error');
      }
    });

    // 历史记录按钮事件
    const historyButton = document.getElementById('historyButton');
    const historyModal = document.getElementById('historyModal');
    const closeButton = historyModal.querySelector('.close-button');
    const historyList = document.getElementById('historyList');

    historyButton.addEventListener('click', async () => {
      try {
        const sessions = await tracker.loadHistory();
        historyList.innerHTML = sessions.map(session => `
          <div class="history-item" data-session-id="${session.id}">
            <div class="history-item__stat">
              <span class="history-item__label">日期</span>
              <span class="history-item__value">${new Date(session.start_time).toLocaleDateString()}</span>
            </div>
            <div class="history-item__stat">
              <span class="history-item__label">时长</span>
              <span class="history-item__value">${UI.formatDuration(session.duration)}</span>
            </div>
            <div class="history-item__stat">
              <span class="history-item__label">距离</span>
              <span class="history-item__value">${(session.distance / 1000).toFixed(2)} km</span>
            </div>
          </div>
        `).join('');
        
        historyModal.hidden = false;
      } catch (error) {
        UI.showToast('加载历史记录失败: ' + error.message, 'error');
      }
    });

    closeButton.addEventListener('click', () => {
      historyModal.hidden = true;
    });

    historyList.addEventListener('click', async (e) => {
      const historyItem = e.target.closest('.history-item');
      if (!historyItem) return;

      try {
        const sessionId = historyItem.dataset.sessionId;
        const positions = await tracker.loadSessionTrack(sessionId);
        
        // 清除当前轨迹
        tracker.state.polyline.setLatLngs([]);
        
        // 显示历史轨迹
        const latLngs = positions.map(pos => [pos.lat, pos.lng]);
        tracker.state.polyline.setLatLngs(latLngs);
        
        // 调整地图视图以显示整个轨迹
        if (latLngs.length > 0) {
          tracker.state.map.fitBounds(tracker.state.polyline.getBounds());
        }
        
        historyModal.hidden = true;
      } catch (error) {
        UI.showToast('加载轨迹失败: ' + error.message, 'error');
      }
    });

    // 注册Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js')
        .then(reg => console.log('Service Worker注册成功:', reg))
        .catch(err => console.error('Service Worker注册失败:', err));
    }
  } catch (error) {
    console.error('应用初始化失败:', error);
    alert('应用初始化失败，请刷新页面重试');
  }
}); 