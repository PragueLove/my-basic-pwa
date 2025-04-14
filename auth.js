// 认证管理类
class AuthManager {
  constructor(supabase) {
    this.supabase = supabase;
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
      // 1. 注册用户
      const { data: authData, error: authError } = await this.supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/index.html?verified=true`,
          data: {
            email: email
          }
        }
      });

      if (authError) {
        console.error('认证错误:', authError);
        // 处理特定的错误情况
        if (authError.message.includes('Email rate limit exceeded')) {
          throw new Error('发送邮件次数超限，请稍后再试');
        }
        throw authError;
      }

      // 检查注册响应
      if (!authData?.user) {
        throw new Error('注册失败：服务器响应异常');
      }

      // 检查邮件发送状态
      if (!authData.user.confirmation_sent_at) {
        throw new Error('验证邮件发送失败，请使用重新发送验证邮件功能');
      }

      console.log('注册响应:', authData); // 添加调试日志

      return { 
        success: true, 
        message: '注册成功！请查收验证邮件。\n如果未收到邮件，请检查垃圾邮件文件夹或使用重新发送功能。',
        user: authData.user 
      };
    } catch (error) {
      console.error('注册失败:', error);
      
      // 处理常见错误
      if (error.message.includes('User already registered')) {
        throw new Error('该邮箱已被注册，请直接登录或使用其他邮箱。');
      }
      if (error.message.includes('Password should be at least 6 characters')) {
        throw new Error('密码长度至少需要6个字符。');
      }
      if (error.message.includes('Invalid email')) {
        throw new Error('请输入有效的邮箱地址。');
      }
      if (error.status === 401) {
        throw new Error('认证失败：请检查 Supabase 配置是否正确');
      }
      
      throw new Error(error.message || '注册失败，请稍后重试');
    }
  }

  /**
   * 重新发送验证邮件
   */
  async resendVerificationEmail(email) {
    try {
      console.log('尝试重新发送验证邮件到:', email); // 添加调试日志
      
      const { data, error } = await this.supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/index.html?verified=true`
        }
      });

      console.log('重发邮件响应:', data); // 添加调试日志

      if (error) {
        console.error('重发邮件错误:', error);
        if (error.message.includes('Email rate limit exceeded')) {
          throw new Error('发送邮件次数超限，请等待一段时间后再试');
        }
        throw error;
      }

      return { 
        success: true, 
        message: '验证邮件已重新发送！\n请检查收件箱和垃圾邮件文件夹。' 
      };
    } catch (error) {
      console.error('发送验证邮件失败:', error);
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
   * @param {HTMLButtonElement} button - 按钮元素
   * @param {boolean} loading - 是否显示加载状态
   */
  static setLoading(button, loading) {
    if (!button) return;
    
    if (loading) {
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

  /**
   * 显示成功消息
   * @param {string} message - 成功信息
   */
  static showSuccess(message) {
    const toast = document.createElement('div');
    toast.className = 'toast success';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 初始化Supabase客户端
  const supabaseUrl = 'https://ebyyrppkpxpfchmbwfxz.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVieXlycHBrcHhwZmNobWJ3Znh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ1OTk2MTUsImV4cCI6MjA2MDE3NTYxNX0.hbB3tN7XvcIcRch1FpEMB3H4wEXy4wz9NNca3inQ5MA';
  
  if (!supabaseUrl || !supabaseKey) {
    alert('Supabase 配置错误！');
    return;
  }
  
  const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
  const authManager = new AuthManager(supabase);

  // 检查是否已登录
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    window.location.href = './main.html';
    return;
  }

  // 注册表单处理
  const registerForm = document.getElementById('register');
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;

    // 表单验证
    if (!email || !password || !confirmPassword) {
      alert('请填写所有必填字段！');
      return;
    }

    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      alert('请输入有效的邮箱地址！');
      return;
    }

    if (password.length < 6) {
      alert('密码长度至少需要6个字符！');
      return;
    }

    if (password !== confirmPassword) {
      alert('两次输入的密码不一致！');
      return;
    }

    try {
      const submitButton = registerForm.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.classList.add('loading');
      submitButton.textContent = '注册中...';

      const result = await authManager.register(email, password);
      console.log('注册结果:', result); // 添加调试日志
      
      // 显示成功消息
      const toast = document.createElement('div');
      toast.className = 'toast success';
      toast.textContent = result.message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 8000); // 显示更长时间
      
      // 注册成功后切换到登录表单
      document.getElementById('register-form').hidden = true;
      document.getElementById('login-form').hidden = false;
      
      // 清空表单
      registerForm.reset();
    } catch (error) {
      console.error('注册表单错误:', error);
      const toast = document.createElement('div');
      toast.className = 'toast error';
      toast.textContent = error.message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    } finally {
      const submitButton = registerForm.querySelector('button[type="submit"]');
      submitButton.disabled = false;
      submitButton.classList.remove('loading');
      submitButton.textContent = '注册';
    }
  });

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
      alert(error.message);
    } finally {
      const submitButton = loginForm.querySelector('button[type="submit"]');
      submitButton.disabled = false;
      submitButton.classList.remove('loading');
    }
  });

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

  // 重发验证邮件
  document.getElementById('resend-verification').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = document.getElementById('register-email').value;
    
    if (!email) {
      alert('请先输入邮箱地址！');
      return;
    }

    try {
      const result = await authManager.resendVerificationEmail(email);
      alert(result.message);
    } catch (error) {
      alert(error.message);
    }
  });
}); 
