/**
 * 系統狀態檢查頁：部署後打開 /status，確認環境變數和資料庫都設定好了
 * 只顯示「有／沒有」，不會顯示任何金鑰內容。
 */
import { envChecklist, supabaseReady } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

async function dbCheck(): Promise<{ ok: boolean; note: string }> {
  if (!supabaseReady()) return { ok: false, note: '先設定 Supabase 環境變數' };
  try {
    const supabase = await createClient();
    // 未登入（anon）查詢：schema.sql 已收回 anon 的權限，所以會得到 42501「沒有權限」＝表存在且有保護（正常）
    // 如果表不存在，會得到 PGRST205
    const { error } = await supabase.from('posts').select('id', { head: true, count: 'exact' });
    if (!error) return { ok: true, note: '連線成功，v2 資料表存在' };
    if (error.code === '42501') return { ok: true, note: '連線成功，資料表存在，未登入者被正確擋下' };
    if (!error.code) return { ok: false, note: '連不到 Supabase，請檢查 NEXT_PUBLIC_SUPABASE_URL 是否正確' };
    if (error.code === '42P01' || error.code === 'PGRST205') return { ok: false, note: '找不到資料表：請在 Supabase 執行 supabase/schema.sql' };
    return { ok: false, note: `連線失敗（代碼 ${error.code}），請檢查網址與公開金鑰` };
  } catch {
    return { ok: false, note: '連不到 Supabase，請檢查 NEXT_PUBLIC_SUPABASE_URL' };
  }
}

export default async function Status() {
  const items = envChecklist();
  const db = await dbCheck();
  const allRequired = items.filter((i) => i.required).every((i) => i.ok) && db.ok;
  return (
    <div className="narrow" style={{ maxWidth: 640 }}>
      <h1>系統狀態</h1>
      <p className="sub">{allRequired ? '必要設定都完成了 ✓' : '還有必要設定沒完成，請依下表到 Vercel → Settings → Environment Variables 補上，然後重新部署。'}</p>
      <div className="card">
        <ul className="clean">
          {items.map((i) => (
            <li key={i.label}>
              {i.ok ? <span className="tag ok">已設定</span> : <span className={`tag ${i.required ? 'err' : ''}`}>{i.required ? '缺少' : '之後再設'}</span>}　{i.label}
            </li>
          ))}
          <li>
            {db.ok ? <span className="tag ok">正常</span> : <span className="tag err">異常</span>}　資料庫：{db.note}
          </li>
        </ul>
      </div>
      <p className="muted">
        設定好後到 <a href="/login">/login</a> 註冊第一個帳號。
      </p>
    </div>
  );
}
