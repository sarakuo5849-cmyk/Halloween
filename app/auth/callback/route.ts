/** 使用者點信箱裡的確認連結後回到這裡：用一次性 code 換登入狀態 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/onboarding', req.url));
  }
  return NextResponse.redirect(new URL('/login?error=' + encodeURIComponent('確認連結無效或已過期，請直接登入試試'), req.url));
}
