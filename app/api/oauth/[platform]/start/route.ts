/**
 * 開始連接社群帳號：/api/oauth/instagram/start?workspace=<id>&brand=<id>
 * 1. 確認是該公司的管理員  2. 產生一次性 state（防 CSRF）存在 httpOnly cookie  3. 轉址到平台授權頁
 */
import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAdapter, isPlatform } from '@/lib/social';

export const runtime = 'nodejs';
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const ws = req.nextUrl.searchParams.get('workspace') ?? '';
  const brand = req.nextUrl.searchParams.get('brand') ?? '';
  if (!isPlatform(platform) || !UUID.test(ws) || !UUID.test(brand)) {
    return NextResponse.json({ error: '參數錯誤' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser(); // getUser 會向 Supabase 驗證，不要用 getSession 判斷權限
  if (!user) return NextResponse.redirect(new URL('/login', req.url));

  // 用「使用者身分」查：RLS 確保只查得到自己公司的資料
  const { data: me } = await supabase
    .from('members')
    .select('role')
    .eq('workspace_id', ws)
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();
  const { data: b } = await supabase.from('brands').select('id').eq('id', brand).eq('workspace_id', ws).maybeSingle();
  if (me?.role !== '管理員' || !b) return NextResponse.json({ error: '只有管理員可以連接社群帳號' }, { status: 403 });

  const state = randomBytes(32).toString('base64url');
  const redirectUri = `${process.env.APP_URL}/api/oauth/${platform}/callback`;
  const res = NextResponse.redirect(getAdapter(platform).authUrl(state, redirectUri));
  res.cookies.set('oauth_state', JSON.stringify({ state, platform, ws, brand, uid: user.id }), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax', // 平台轉址回來是「頂層導覽」，lax 會帶上 cookie
    path: '/api/oauth',
    maxAge: 600, // 10 分鐘內要完成授權
  });
  return res;
}
