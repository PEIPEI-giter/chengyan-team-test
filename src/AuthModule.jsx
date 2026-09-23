import React, {useEffect, useState} from 'react';
import {CheckCircle2, LockKeyhole, LogIn, Plus, RefreshCw, ShieldCheck, UserRound, Users} from 'lucide-react';

async function authRequest(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers:{'Content-Type':'application/json', ...(options.headers || {})},
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.code !== 200) throw new Error(payload?.message || '请求失败，请稍后重试');
  return payload.data;
}

export const loadCurrentUser = () => authRequest('/auth/me');
export const logoutCurrentUser = () => authRequest('/auth/logout', {method:'POST'});

export function LoginPage({onLogin}) {
  const [form, setForm] = useState({username:'', password:''});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const submit = async event => {
    event.preventDefault();
    setWorking(true);
    setError('');
    try {
      const user = await authRequest('/auth/login', {method:'POST', body:JSON.stringify(form)});
      onLogin(user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  };

  return <main className="login-page">
    <section className="login-card">
      <div className="login-brand"><span>澄</span><div><h1>澄研智库</h1><p>团队知识与协同工作台</p></div></div>
      <div className="login-copy"><ShieldCheck/><div><h2>账号登录</h2><p>请输入团队测试账号进入系统。</p></div></div>
      <form onSubmit={submit}>
        <label><span>账号</span><div><UserRound/><input autoFocus autoComplete="username" value={form.username} onChange={event => setForm(current => ({...current, username:event.target.value}))} placeholder="请输入账号"/></div></label>
        <label><span>密码</span><div><LockKeyhole/><input type="password" autoComplete="current-password" value={form.password} onChange={event => setForm(current => ({...current, password:event.target.value}))} placeholder="请输入密码"/></div></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button disabled={working || !form.username.trim() || !form.password}><LogIn/>{working ? '正在登录…' : '登录'}</button>
      </form>
      <small>测试账号由管理员统一分发，请勿共享个人飞书密码或令牌。</small>
    </section>
  </main>;
}

const blankUser = {username:'', displayName:'', department:'', role:'member', password:''};

export function UserManagement({currentUser, onNotice}) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(blankUser);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try { setUsers(await authRequest('/users')); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const createUser = async event => {
    event.preventDefault();
    setWorking('create');
    setError('');
    try {
      await authRequest('/users', {method:'POST', body:JSON.stringify(form)});
      setForm(blankUser);
      await load();
      onNotice('测试用户已创建');
    } catch (requestError) { setError(requestError.message); }
    finally { setWorking(''); }
  };

  const updateUser = async (user, changes) => {
    setWorking(`user-${user.id}`);
    setError('');
    try {
      await authRequest(`/users/${user.id}`, {method:'PUT', body:JSON.stringify(changes)});
      await load();
      onNotice('用户状态已更新');
    } catch (requestError) { setError(requestError.message); }
    finally { setWorking(''); }
  };

  if (currentUser.role !== 'admin') return <section className="user-admin empty-admin"><ShieldCheck/><h2>无权访问用户管理</h2></section>;
  return <div className="user-admin">
    <section className="admin-head"><div><Users/><span><h1>用户管理</h1><p>创建团队测试账号，设置管理员或成员角色。</p></span></div><em>{users.filter(user => user.active).length} 个启用账号</em></section>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <section className="create-user-card"><div><Plus/><span><h2>新增用户</h2><p>密码只在创建时填写，不会在页面中显示。</p></span></div><form onSubmit={createUser}>
      <label><span>登录账号 *</span><input value={form.username} onChange={event => setForm(current => ({...current, username:event.target.value}))} placeholder="例如：wang.siyu" maxLength="30"/></label>
      <label><span>姓名 *</span><input value={form.displayName} onChange={event => setForm(current => ({...current, displayName:event.target.value}))} placeholder="真实姓名" maxLength="30"/></label>
      <label><span>部门 *</span><input value={form.department} onChange={event => setForm(current => ({...current, department:event.target.value}))} placeholder="例如：市场部" maxLength="30"/></label>
      <label><span>角色 *</span><select value={form.role} onChange={event => setForm(current => ({...current, role:event.target.value}))}><option value="member">成员</option><option value="admin">管理员</option></select></label>
      <label><span>初始密码 *</span><input type="password" autoComplete="new-password" value={form.password} onChange={event => setForm(current => ({...current, password:event.target.value}))} placeholder="至少 8 位" maxLength="72"/></label>
      <button disabled={working === 'create' || !form.username || !form.displayName || !form.department || form.password.length < 8}>{working === 'create' ? <RefreshCw className="spin"/> : <Plus/>}{working === 'create' ? '创建中…' : '创建用户'}</button>
    </form></section>
    <section className="user-list-card"><div className="user-list-head"><div><h2>团队账号</h2><p>管理员可调整角色并启用或停用账号。</p></div><button onClick={load} disabled={loading}><RefreshCw className={loading ? 'spin' : ''}/>刷新</button></div>
      {loading ? <div className="admin-loading"><RefreshCw className="spin"/>正在读取用户…</div> : <div className="user-list">{users.map(user => <article key={user.id} className={user.active ? '' : 'inactive'}><span className="user-avatar">{user.displayName.slice(0, 1)}</span><div><b>{user.displayName}{user.id === currentUser.id && <small>当前账号</small>}</b><p>@{user.username} · {user.department}</p></div><label><span>角色</span><select value={user.role} disabled={working === `user-${user.id}` || user.id === currentUser.id} onChange={event => updateUser(user, {role:event.target.value})}><option value="member">成员</option><option value="admin">管理员</option></select></label><button className={user.active ? 'disable-user' : 'enable-user'} disabled={working === `user-${user.id}` || user.id === currentUser.id} onClick={() => updateUser(user, {active:!user.active})}>{user.active ? '停用' : '启用'}</button>{user.active && <CheckCircle2 className="active-mark"/>}</article>)}</div>}
    </section>
  </div>;
}
