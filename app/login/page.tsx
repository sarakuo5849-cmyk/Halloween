import { redirect } from 'next/navigation';
import { Flash, type SearchParams } from '@/components/Flash';
import { supabaseReady } from '@/lib/env';
import { login, signup } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  if (!supabaseReady()) redirect('/status');
  return (
    <div className="narrow">
      <h1>歡迎使用</h1>
      <p className="sub">登入後即可管理各品牌的社群留言。</p>
      <Flash searchParams={searchParams} />

      <form className="card" action={login}>
        <h2>登入</h2>
        <label htmlFor="li-email">Email</label>
        <input id="li-email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="li-pw">密碼</label>
        <input id="li-pw" name="password" type="password" autoComplete="current-password" required />
        <p />
        <button type="submit">登入</button>
      </form>

      <form className="card" action={signup}>
        <h2>第一次使用？註冊帳號</h2>
        <label htmlFor="su-email">Email</label>
        <input id="su-email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="su-pw">密碼（至少 8 個字元）</label>
        <input id="su-pw" name="password" type="password" autoComplete="new-password" minLength={8} required />
        <p className="muted">被邀請加入公司的人，請用邀請你的 email 註冊，登入後會自動加入。</p>
        <button type="submit" className="secondary">
          註冊
        </button>
      </form>
    </div>
  );
}
