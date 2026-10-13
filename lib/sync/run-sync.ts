/**
 * 批次同步留言（每 15 分鐘被呼叫一次）
 *
 * 流程：領取一批到期的帳號 → 逐一（不併發，避免瞬間打爆 API）
 *   解密 token →（必要時刷新）→ 扣配額後抓留言 → 寫入資料庫 → 回報成功／失敗
 * 防重複：資料庫用「租約＋skip locked」領取；留言用 (公司, 平台, 留言ID) 去重。
 * 時間：Vercel 函式有時間上限，超過 deadline 的帳號留到下一輪（租約 10 分鐘後自動釋放）。
 */
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdapter, isPlatform, QUOTA } from '@/lib/social';
import { loadSocialSecret, saveSocialSecret } from '@/lib/social/secrets';
import { PlatformError, type SocialAccountRow } from '@/lib/social/types';

export type SyncSummary = { claimed: number; succeeded: number; failed: number; deferred: number; inserted: number };

export async function runCommentSync({ batchSize = 10, deadlineMs = 45_000 } = {}): Promise<SyncSummary> {
  const started = Date.now();
  const admin = createAdminClient();
  const summary: SyncSummary = { claimed: 0, succeeded: 0, failed: 0, deferred: 0, inserted: 0 };

  const { data: accounts, error } = await admin.rpc('srv_claim_sync_batch', { p_limit: batchSize });
  if (error) throw new Error(`領取同步工作失敗：${error.code}`);
  summary.claimed = accounts?.length ?? 0;

  for (const account of (accounts ?? []) as SocialAccountRow[]) {
    if (Date.now() - started > deadlineMs) {
      summary.deferred++; // 時間不夠，下一輪再處理
      continue;
    }
    try {
      if (!isPlatform(account.platform)) throw new PlatformError(`尚未支援 ${account.platform} 同步`);
      const adapter = getAdapter(account.platform);
      const secret = await loadSocialSecret(admin, account.id);
      if (!secret) throw new PlatformError('找不到授權 token，請重新連接', true);

      let accessToken = secret.accessToken;
      // token 5 分鐘內到期就先刷新（YouTube 的 access token 只有 1 小時）
      const expiringSoon = secret.expiresAt && secret.expiresAt.getTime() < Date.now() + 5 * 60_000;
      if (expiringSoon) {
        if (!adapter.refresh || !secret.refreshToken) throw new PlatformError('授權已過期，請重新連接', true);
        const fresh = await adapter.refresh(secret.refreshToken);
        await saveSocialSecret(admin, account.id, { ...fresh, keepRefresh: secret.refreshToken });
        accessToken = fresh.accessToken;
      }

      const { dailyLimit, tz } = QUOTA[account.platform];
      const result = await adapter.fetchComments({
        account,
        accessToken,
        consumeQuota: async (units) => {
          const { data, error: qErr } = await admin.rpc('srv_try_consume_quota', {
            p_platform: account.platform,
            p_units: units,
            p_daily_limit: dailyLimit,
            p_tz: tz,
          });
          return !qErr && data === true;
        },
      });

      const { data: inserted, error: insErr } = await admin.rpc('srv_ingest_comments', {
        p_account: account.id,
        p_items: result.items,
      });
      if (insErr) throw new Error(`寫入留言失敗：${insErr.code}`);
      summary.inserted += inserted ?? 0;

      await admin.rpc('srv_finish_sync', { p_account: account.id, p_ok: true, p_cursor: result.cursor });
      summary.succeeded++;
    } catch (e) {
      const pe = e instanceof PlatformError ? e : null;
      await admin.rpc('srv_finish_sync', {
        p_account: account.id,
        p_ok: false,
        p_error: e instanceof Error ? e.message : '未知錯誤', // 錯誤訊息都是我們自己寫的，不含 token
        p_token_expired: pe?.tokenExpired ?? false,
      });
      summary.failed++;
    }
  }
  return summary;
}
