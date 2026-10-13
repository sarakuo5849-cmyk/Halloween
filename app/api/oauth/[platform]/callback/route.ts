/**
 * 平台授權完成後轉回這裡：驗證 state → 用 code 換 token → 加密後存進 Supabase
 * Token 從頭到尾只在伺服器記憶體裡，不會出現在網址、前端、log。
 */
import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdapter, isPlatform } from '@/lib/social';
import { saveSocialSecret } from '@/lib/social/secrets';

export const runtime = 'nodejs';

const back = (req: NextRequest, q: string) => {
  const res = NextResponse.redirect(new URL(`/settings/social?${q}`, req.url));
  res.cookies.set('oauth_state', '', { path: '/api/oauth', maxAge: 0 }); // state 只能用一次
  return res;
};

function sameString(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const sp = req.nextUrl.searchParams;
  if (sp.get('error')) return back(req, 'error=denied'); // 使用者按了「取消」

  // 1) 驗證 state（防 CSRF：確認這次授權是本人剛剛從我們網站發起的）
  let saved: { state: string; platform: string; ws: string; brand: string; uid: string };
  try {
    saved = JSON.parse(req.cookies.get('oauth_state')?.value ?? '');
  } catch {
    return back(req, 'error=state');
  }
  const code = sp.get('code');
  if (!code || !isPlatform(platform) || saved.platform !== platform || !sameString(saved.state, sp.get('state') ?? '')) {
    return back(req, 'error=state');
  }

  // 2) 再確認一次：同一個人、仍是管理員（cookie 可能被竄改，所以以資料庫為準）
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== saved.uid) return back(req, 'error=session');
  const { data: me } = await supabase
    .from('members')
    .select('id, name, role')
    .eq('workspace_id', saved.ws)
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();
  if (me?.role !== '管理員') return back(req, 'error=forbidden');

  try {
    // 3) 換 token、找出可管理的帳號
    const adapter = getAdapter(platform);
    const redirectUri = `${process.env.APP_URL}/api/oauth/${platform}/callback`;
    const tokens = await adapter.exchangeCode(code, redirectUri);
    const accounts = await adapter.discoverAccounts(tokens);
    if (!accounts.length) return back(req, 'error=no_account');

    const admin = createAdminClient();
    for (const acc of accounts) {
      // 4) 帳號基本資料：用「使用者身分」寫入，RLS 再把關一次（只有管理員能寫）
      const { data: row, error } = await supabase
        .from('social_accounts')
        .upsert(
          {
            workspace_id: saved.ws,
            brand_id: saved.brand,
            platform,
            handle: acc.handle,
            external_id: acc.externalId,
            provider_user_id: acc.providerUserId,
            status: '已連接',
            connected_by: me.id,
            next_sync_at: new Date().toISOString(), // 馬上排入下一輪同步
            fail_count: 0,
            last_error: null,
          },
          { onConflict: 'workspace_id,platform,external_id' },
        )
        .select('id')
        .single();
      if (error || !row) throw new Error(`儲存帳號失敗：${error?.code}`);

      // 5) Token：加密後用伺服器權限寫入 secrets 表（前端完全碰不到這張表）
      await saveSocialSecret(admin, row.id, acc.tokens);
    }

    await supabase.from('audit_log').insert({
      workspace_id: saved.ws,
      actor: me.name,
      action: '連接社群帳號',
      detail: `${platform}：${accounts.map((a) => a.handle).join('、')}`,
    });
    return back(req, `connected=${accounts.length}`);
  } catch (e) {
    console.error('[oauth] callback failed:', e instanceof Error ? e.message : 'unknown'); // 不印出 token
    return back(req, 'error=exchange');
  }
}
