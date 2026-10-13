/** Meta 資料刪除回呼的「查詢進度」頁：/data-deletion?code=確認碼 */
import { createAdminClient } from '@/lib/supabase/admin';
import { serverReady } from '@/lib/env';
import type { SearchParams } from '@/components/Flash';

export const dynamic = 'force-dynamic';

export default async function DataDeletion({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const code = typeof sp.code === 'string' && /^[0-9a-f]{18}$/.test(sp.code) ? sp.code : null;
  let row: { status: string; created_at: string; deleted_accounts: number } | null = null;
  if (code && serverReady()) {
    const { data } = await createAdminClient()
      .from('data_deletion_requests')
      .select('status, created_at, deleted_accounts')
      .eq('confirmation_code', code)
      .maybeSingle();
    row = data;
  }
  return (
    <div className="narrow card">
      <h1>資料刪除查詢</h1>
      {!code && <p>請使用 Facebook 提供的連結（含確認碼）查詢。</p>}
      {code && !row && <p>找不到確認碼 {code} 的紀錄。</p>}
      {row && (
        <>
          <p>
            確認碼：<code>{code}</code>
          </p>
          <p>
            狀態：<strong>{row.status}</strong>（受理時間 {new Date(row.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}）
          </p>
          <p className="muted">已刪除 {row.deleted_accounts} 個社群帳號，以及其授權、貼文與留言紀錄。</p>
        </>
      )}
      <p className="muted">
        你也可以在本工具的「帳號設定 → 刪除帳號」刪除全部資料。若有問題請聯絡：{process.env.CONTACT_EMAIL || '（尚未設定聯絡信箱）'}
      </p>
    </div>
  );
}
