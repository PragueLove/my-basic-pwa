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
      // 登录成功后跳转到主页面
      window.location.href = './main.html';
    } catch (error) {
      console.error('用户数据同步失败:', error);
    }

    return data.user;
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
          emailRedirectTo: `${window.location.origin}/index.html?verified=true`
        }
      });

      if (authError) throw authError;

      // 2. 创建用户配置文件
      if (authData.user) {
        const { error: profileError } = await this.supabase
          .from('users')
          .insert([
            {
              id: authData.user.id,
              email: email,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          ]);

        if (profileError) {
          console.error('创建用户配置文件失败:', profileError);
          // 注意：即使配置文件创建失败，我们仍然允许用户注册完成
          // 因为用户认证已经成功，配置文件可以稍后创建
        }
      }

      return { success: true, message: '注册成功！请查收验证邮件。' };
    } catch (error) {
      console.error('注册失败:', error);
      throw new Error(error.message || '注册失败，请稍后重试');
    }
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
        emailRedirectTo: `${window.location.origin}/index.html?verified=true`
      }
    });
    
    if (error) throw error;
    return { success: true };
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
  const supabaseUrl = 'YOUR_SUPABASE_URL';  // 替换为您的 Supabase URL
  const supabaseKey = 'YOUR_ANON_KEY';  // 替换为您的 Supabase Anon Key
  
  if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('YOUR_SUPABASE_URL')) {
    console.error('请先配置 Supabase 密钥！');
    return;
  }
  
  const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
  const authManager = new AuthManager(supabase);

  // 保存按钮原始文本
  document.querySelectorAll('button').forEach(button => {
    button.setAttribute('data-original-text', button.textContent);
  });

  // 注册表单提交处理
  const registerForm = document.getElementById('register');
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;

    // 验证密码
    if (password !== confirmPassword) {
      alert('两次输入的密码不一致！');
      return;
    }

    try {
      const submitButton = registerForm.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.classList.add('loading');

      const result = await authManager.register(email, password);
      alert(result.message);
      
      // 注册成功后切换到登录表单
      document.getElementById('register-form').hidden = true;
      document.getElementById('login-form').hidden = false;
    } catch (error) {
      alert(error.message);
    } finally {
      const submitButton = registerForm.querySelector('button[type="submit"]');
      submitButton.disabled = false;
      submitButton.classList.remove('loading');
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
      UI.showSuccess('登录成功！');
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
      UI.showSuccess('验证邮件已重新发送，请查收');
    } catch (error) {
      console.error('发送失败:', error);
      UI.showError(error.message);
    } finally {
      UI.setLoading(button, false);
    }
  });

  // 检查是否已登录，如果已登录则跳转到主页
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    window.location.href = './main.html';
    return;
  }
}); 