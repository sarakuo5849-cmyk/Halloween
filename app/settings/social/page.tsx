import { Flash, type SearchParams } from '@/components/Flash';
import { requireMember } from '@/lib/workspace';
import { metaReady, youtubeReady } from '@/lib/env';
import { disconnectAccount } from './actions';

const CALLBACK_ERRORS: Record<string, string> = {
  denied: '你在授權頁按了取消',
  state: '授權逾時或連結無效，請重新點「連接」',
  session: '登入狀態不一致，請重新登入後再試',
  forbidden: '只有管理員可以連接社群帳號',
  no_account: '沒有找到可管理的帳號（IG 需為商業／創作者帳號並連結 FB 粉專）',
  exchange: '和平台交換授權失敗，請稍後再試',
};

const statusTag = (s: string) => {
  const cls = s === '已連接' ? 'ok' : s === '同步中' || s === '等待授權' ? 'warn' : 'err';
  return <span className={`tag ${cls}`}>{s}</span>;
};
const fmt = (t: string | null) => (t ? new Date(t).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '—');

export default async function SocialSettings({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, workspaceId, isAdmin } = await requireMember();
  const sp = await searchParams;
  const cbError = typeof sp.error === 'string' ? CALLBACK_ERRORS[sp.error] : undefined;
  const connectedN = typeof sp.connected === 'string' ? Number(sp.connected) : 0;

  const [{ data: brands }, { data: accounts }] = await Promise.all([
    supabase.from('brands').select('id, name').eq('workspace_id', workspaceId).order('created_at'),
    supabase
      .from('social_accounts')
      .select('id, brand_id, platform, handle, status, last_sync_at, last_error')
      .eq('workspace_id', workspaceId)
      .order('created_at'),
  ]);
  const platforms = [
    { key: 'instagram', label: 'Instagram', ready: metaReady(), why: '需要 Meta 開發者帳號與 App 審核' },
    { key: 'youtube', label: 'YouTube', ready: youtubeReady(), why: '需要 Google Cloud OAuth 設定' },
  ];

  return (
    <>
      <h1>社群帳號連接</h1>
      <p className="sub">連接後每 15 分鐘自動同步留言。授權 token 會加密保存，任何人都無法在網頁上看到。</p>
      {cbError ? <div className="msg error">{cbError}</div> : !sp.ok && !sp.error && connectedN > 0 && <div className="msg ok">已連接 {connectedN} 個帳號</div>}
      {!cbError && <Flash searchParams={searchParams} />}

      <div className="card">
        <h2>平台狀態</h2>
        <ul className="clean">
          {platforms.map((p) => (
            <li key={p.key}>
              <strong>{p.label}</strong>　{p.ready ? <span className="tag ok">可連接</span> : <span className="tag warn">尚未設定</span>}
              {!p.ready && <div className="muted">{p.why}，設定好環境變數後才能使用。</div>}
            </li>
          ))}
          <li>
            <strong>Facebook 粉專</strong>　<span className="tag">開發中</span>
          </li>
          <li>
            <strong>Facebook 社團</strong>　<span className="tag err">目前不支援</span>
            <div className="muted">Meta 已停止提供社團 API。</div>
          </li>
        </ul>
      </div>

      {(brands ?? []).length === 0 && <p className="muted">請先到首頁新增品牌，社群帳號要掛在品牌底下。</p>}

      {(brands ?? []).map((b) => {
        const mine = (accounts ?? []).filter((a) => a.brand_id === b.id);
        return (
          <div className="card" key={b.id}>
            <h2>{b.name}</h2>
            {mine.length === 0 && <p className="muted">尚未連接任何帳號。</p>}
            {mine.map((a) => (
              <div key={a.id} style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
                <strong>{a.handle}</strong> <span className="muted">{a.platform}</span> {statusTag(a.status)}
                <div className="muted">
                  上次同步：{fmt(a.last_sync_at)}
                  {a.last_error && `　｜　錯誤：${a.last_error}`}
                </div>
                {isAdmin && (
                  <form action={disconnectAccount} className="row" style={{ marginTop: 6 }}>
                    <input type="hidden" name="account_id" value={a.id} />
                    <label className="check" style={{ margin: 0 }}>
                      <input type="checkbox" name="confirm" value="yes" required /> 我了解解除後，這個帳號的貼文與留言紀錄會一併刪除
                    </label>
                    <button type="submit" className="secondary">
                      解除連接
                    </button>
                  </form>
                )}
              </div>
            ))}
            {isAdmin && (
              <div className="row" style={{ marginTop: 12 }}>
                {platforms.map((p) =>
                  p.ready ? (
                    <a key={p.key} className="btn" href={`/api/oauth/${p.key}/start?workspace=${workspaceId}&brand=${b.id}`}>
                      連接 {p.label}
                    </a>
                  ) : (
                    <span key={p.key} className="btn secondary disabled" aria-disabled="true">
                      連接 {p.label}（尚未設定）
                    </span>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
