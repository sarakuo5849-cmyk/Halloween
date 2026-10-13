/**
 * Proxy（Next.js 16 起取代舊的 middleware）：每個頁面請求進來前先執行
 * 1. 更新 Supabase 登入狀態（token 快過期時自動換新，寫回 cookie）
 * 2. 沒登入的人想進「需要登入的頁面」→ 導到 /login
 * 注意：這裡只是「方便導頁」，真正的權限檢查在每個頁面和資料庫 RLS，不靠這裡。
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED = ['/app', '/onboarding', '/settings'];

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next(); // 還沒設定環境變數：交給 /status 頁提示

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && PROTECTED.some((p) => path === p || path.startsWith(p + '/'))) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = '';
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  // 靜態檔案、原型展示頁、API（各自檢查身分）不經過這裡
  matcher: ['/((?!_next/static|_next/image|favicon.ico|prototype.html|api/).*)'],
};
