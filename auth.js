// 认证管理类
import { supabase } from './config.js';

class AuthManager {
  constructor() {
    this.supabase = supabase;
    this.checkSession();
  }

  /**
   * 检查当前会话状态
   */
  async checkSession() {
    try {
      const { data: { session }, error } = await this.supabase.auth.getSession();
      if (error) throw error;
      return session;
    } catch (error) {
      console.error('检查会话状态失败:', error);
      return null;
    }
  }

  /**
   * 用户登录方法
   * @param {string} email - 邮箱
   * @param {string} password - 密码
   */
  async login(email, password) {
    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      // 登录成功后跳转到主页面
      window.location.href = './main.html';
      return data.user;
    } catch (error) {
      console.error('登录失败:', error);
      throw new Error(error.message || '登录失败，请检查邮箱和密码是否正确');
    }
  }

  /**
   * 用户注册方法
   * @param {string} email - 邮箱
   * @param {string} password - 密码
   */
  async register(email, password) {
    try {
      console.log('开始注册流程，邮箱:', email);

      // 1. 注册用户
      const { data, error } = await this.supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            email: email,
            signup_date: new Date().toISOString()
          },
          emailRedirectTo: `${window.location.origin}/login.html`
        }
      });

      console.log('注册响应:', data, error);

      if (error) {
        throw error;
      }

      if (!data?.user) {
        throw new Error('注册失败：未收到用户数据');
      }

      // 检查邮件确认状态
      if (data.user.confirmation_sent_at) {
        console.log('验证邮件已发送时间:', data.user.confirmation_sent_at);
        return {
          success: true,
          message: '注册成功！请查收验证邮件。\n如果未收到邮件，请检查垃圾邮件文件夹或使用重新发送功能。',
          user: data.user
        };
      } else {
        console.warn('未检测到验证邮件发送确认');
        throw new Error('验证邮件发送失败，请使用重新发送验证邮件功能');
      }
    } catch (error) {
      console.error('注册失败:', error);
      
      // 处理常见错误
      if (error.message?.includes('User already registered')) {
        throw new Error('该邮箱已被注册，请直接登录或使用其他邮箱。');
      }
      if (error.message?.includes('Password should be at least 6 characters')) {
        throw new Error('密码长度至少需要6个字符。');
      }
      if (error.message?.includes('Invalid email')) {
        throw new Error('请输入有效的邮箱地址。');
      }
      
      throw new Error(error.message || '注册失败，请稍后重试');
    }
  }

  /**
   * 重新发送验证邮件
   * @param {string} email - 邮箱地址
   */
  async resendVerificationEmail(email) {
    try {
      console.log('尝试重新发送验证邮件到:', email);
      
      const { data, error } = await this.supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: window.location.origin + '/login.html'
        }
      });

      console.log('重发邮件响应:', data, error);

      if (error) {
        throw error;
      }

      return {
        success: true,
        message: '验证邮件已重新发送！\n请检查收件箱和垃圾邮件文件夹。'
      };
    } catch (error) {
      console.error('发送验证邮件失败:', error);
      
      if (error.message?.includes('Email rate limit exceeded')) {
        throw new Error('发送邮件次数超限，请等待一段时间后再试');
      }
      
      throw new Error(error.message || '发送验证邮件失败，请稍后重试');
    }
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
      throw error;
    }
  }
}

// UI 管理类
class UI {
  /**
   * 显示加载状态
   * @param {HTMLElement} element - 要显示加载状态的元素
   * @param {boolean} loading - 是否显示加载状态
   */
  static setLoading(element, loading) {
    if (!element) return;
    
    if (loading) {
      element.setAttribute('data-original-text', element.textContent);
      element.disabled = true;
      element.classList.add('loading');
      element.textContent = '处理中...';
    } else {
      element.disabled = false;
      element.classList.remove('loading');
      element.textContent = element.getAttribute('data-original-text') || element.textContent;
    }
  }

  /**
   * 显示错误消息
   * @param {string} message - 错误信息
   */
  static showError(message) {
    this.showToast(message, 'error');
  }

  /**
   * 显示成功消息
   * @param {string} message - 成功信息
   */
  static showSuccess(message) {
    this.showToast(message, 'success');
  }

  /**
   * 显示 Toast 消息
   * @param {string} message - 消息内容
   * @param {string} type - 消息类型（success/error）
   */
  static showToast(message, type = 'success') {
    // 移除现有的 toast
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // 自动移除
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// 初始化
const authManager = new AuthManager();

// 检查用户认证状态
async function checkAuth() {
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error) {
    console.error('认证状态检查失败:', error.message);
    return;
  }

  if (session) {
    window.location.href = '/dashboard.html';
  }
}

// 页面加载时检查认证状态
window.addEventListener('load', checkAuth);

// 登录表单处理
const loginForm = document.getElementById('login');
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    const submitButton = loginForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.classList.add('loading');

    await authManager.login(email, password);
  } catch (error) {
    alert('登录失败：' + error.message);
  } finally {
    const submitButton = loginForm.querySelector('button[type="submit"]');
    submitButton.disabled = false;
    submitButton.classList.remove('loading');
  }
});

// 注册表单处理
const registerForm = document.getElementById('register');
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;

    // 表单验证
    if (!email) {
      UI.showError('请输入邮箱地址');
      return;
    }

    if (!password) {
      UI.showError('请输入密码');
      return;
    }

    if (password.length < 6) {
      UI.showError('密码长度至少需要6个字符');
      return;
    }

    if (password !== confirmPassword) {
      UI.showError('两次输入的密码不一致');
      return;
    }

    try {
      const submitButton = registerForm.querySelector('button[type="submit"]');
      UI.setLoading(submitButton, true);

      const result = await authManager.register(email, password);
      console.log('注册结果:', result);
      
      // 显示成功消息
      UI.showSuccess(result.message || '注册成功！请查收验证邮件。');
      
      // 清空表单
      registerForm.reset();
      
      // 3秒后跳转到登录页面
      setTimeout(() => {
        window.location.href = './login.html';
      }, 3000);
    } catch (error) {
      console.error('注册失败:', error);
      UI.showError(error.message || '注册失败，请稍后重试');
    } finally {
      const submitButton = registerForm.querySelector('button[type="submit"]');
      UI.setLoading(submitButton, false);
    }
  });
}

// 表单切换处理
document.getElementById('show-register').addEventListener('click', (e) => {
  e.preventDefault();
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  loginForm.hidden = true;
  registerForm.hidden = false;
});

document.getElementById('show-login').addEventListener('click', (e) => {
  e.preventDefault();
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  loginForm.hidden = false;
  registerForm.hidden = true;
});

// 重发验证邮件处理
const resendVerificationButton = document.getElementById('resend-verification');
if (resendVerificationButton) {
  resendVerificationButton.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = document.getElementById('register-email').value.trim();
    
    if (!email) {
      UI.showError('请先输入邮箱地址');
      return;
    }

    try {
      UI.setLoading(resendVerificationButton, true);
      const result = await authManager.resendVerificationEmail(email);
      UI.showSuccess(result.message || '验证邮件已重新发送！');
    } catch (error) {
      console.error('发送验证邮件失败:', error);
      UI.showError(error.message || '发送失败，请稍后重试');
    } finally {
      UI.setLoading(resendVerificationButton, false);
    }
  });
} 