'use server';
/**
 * 一鍵刪除帳號（個資法：當事人請求刪除個人資料）
 *
 * 使用方式（前端 Client Component）：
 *   const [state, action, pending] = useActionState(deleteMyAccount, null);
 *   <form action={action}>
 *     <input name="confirm" placeholder="輸入：刪除我的帳號" />
 *     <button disabled={pending}>永久刪除</button>
 *     {state?.error && <p>{state.error}</p>}
 *   </form>
 *
 * 步驟：
 *  1. 安全檢查：已登入、輸入確認文字、15 分鐘內登入過（防止別人用你沒登出的電腦刪帳號）
 *  2. 看刪除計畫：若你是某公司唯一管理員但還有其他成員 → 擋下，請先移交管理員
 *  3. 盡力撤銷平台授權（呼叫 Meta / Google 撤銷 API；失敗不影響後續刪除）
 *  4. 資料庫一個交易內完成：整間公司刪除（token、貼文、留言、回覆…連動刪除）或匿名化你的成員資料
 *  5. 刪除 Supabase 登入帳號 → profiles 連動刪除
 *  重複執行是安全的：第 4 步完成但第 5 步失敗時，再按一次即可。
 */
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdapter, isPlatform } from '@/lib/social';
import { loadSocialSecret } from '@/lib/social/secrets';

const CONFIRM_TEXT = '刪除我的帳號';
const RECENT_LOGIN_MS = 15 * 60_000;

export type DeleteResult = { ok: false; error: string };

export async function deleteMyAccount(_prev: DeleteResult | null, formData: FormData): Promise<DeleteResult> {
  // 1) 安全檢查
  if (formData.get('confirm') !== CONFIRM_TEXT) return { ok: false, error: `請輸入「${CONFIRM_TEXT}」確認` };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: '請先登入' };
  const lastLogin = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : 0;
  if (Date.now() - lastLogin > RECENT_LOGIN_MS) {
    return { ok: false, error: '為了安全，請重新登入後 15 分鐘內再操作' };
  }

  const admin = createAdminClient();

  // 2) 刪除計畫
  const { data: plan, error: planErr } = await admin.rpc('srv_deletion_plan', { p_uid: user.id });
  if (planErr) return { ok: false, error: '暫時無法刪除，請稍後再試' };
  const rows = (plan ?? []) as { workspace_id: string; workspace_name: string; action: string }[];
  const blocked = rows.filter((r) => r.action === 'blocked_sole_admin');
  if (blocked.length) {
    return {
      ok: false,
      error: `你是「${blocked.map((b) => b.workspace_name).join('、')}」唯一的管理員，請先在「團隊」頁指定另一位管理員`,
    };
  }

  // 3) 盡力撤銷平台授權（只針對會被整間刪除的公司；其他公司的帳號屬於公司，保留）
  const doomed = rows.filter((r) => r.action === 'delete_workspace').map((r) => r.workspace_id);
  if (doomed.length) {
    const { data: accounts } = await admin
      .from('social_accounts')
      .select('id, platform, provider_user_id')
      .in('workspace_id', doomed);
    await Promise.allSettled(
      (accounts ?? []).map(async (a) => {
        if (!isPlatform(a.platform)) return;
        const s = await loadSocialSecret(admin, a.id);
        if (s) await getAdapter(a.platform).revoke({ ...s, providerUserId: a.provider_user_id });
      }),
    );
  }

  // 4) 資料庫：連動刪除／匿名化（同一個交易）
  const { error: delErr } = await admin.rpc('srv_delete_user_data', { p_uid: user.id });
  if (delErr) return { ok: false, error: '刪除資料失敗，請稍後再試' };

  // 5) 刪除登入帳號
  const { error: authErr } = await admin.auth.admin.deleteUser(user.id);
  if (authErr) return { ok: false, error: '資料已刪除，但登入帳號刪除失敗，請再按一次' };

  await supabase.auth.signOut().catch(() => {});
  redirect('/goodbye'); // 顯示「已刪除」說明頁
}
