import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { supabaseReady } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

// 這是需要登入的應用程式：每次請求都重新產生頁面（避免把登入狀態或環境變數「凍結」在建置時）
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '社群經營工作台',
  description: '多品牌社群留言管理',
};

async function currentUser() {
  if (!supabaseReady()) return null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="zh-Hant">
      <body>
        <header className="topbar">
          <Link href="/" className="logo">
            社群經營工作台
          </Link>
          <nav>
            {user ? (
              <>
                <Link href="/app">首頁</Link>
                <Link href="/settings/social">社群帳號</Link>
                <Link href="/settings/account">帳號設定</Link>
                <a href="/prototype.html">原型展示</a>
                <form action="/auth/signout" method="post">
                  <button className="linkbtn" type="submit">
                    登出
                  </button>
                </form>
              </>
            ) : (
              <>
                <a href="/prototype.html">原型展示</a>
                <Link href="/login">登入</Link>
              </>
            )}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
