import Link from 'next/link';
import { Flash, type SearchParams } from '@/components/Flash';
import { requireMember } from '@/lib/workspace';
import { PRIVACY_VERSION } from '@/lib/privacy';
import { acceptPrivacy, assignBrand, createBrand, inviteMember } from './actions';

export default async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, user, me, workspaceId, isAdmin } = await requireMember();

  // 以下查詢都經過 RLS：操作人員只會拿到被指派的品牌
  const [{ data: brands }, { data: members }, { data: accounts }, { count: openCount }, { data: profile }] = await Promise.all([
    supabase.from('brands').select('id, name').eq('workspace_id', workspaceId).order('created_at'),
    supabase.from('members').select('id, name, email, role, user_id, active, member_brands(brand_id, is_lead)').eq('workspace_id', workspaceId).order('created_at'),
    supabase.from('social_accounts').select('id, status').eq('workspace_id', workspaceId),
    supabase.from('comments').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', '待處理'),
    supabase.from('profiles').select('privacy_version').eq('id', user.id).maybeSingle(),
  ]);
  const brandName = new Map((brands ?? []).map((b) => [b.id, b.name]));
  const connected = (accounts ?? []).filter((a) => a.status === '已連接' || a.status === '同步中').length;
  const operators = (members ?? []).filter((m) => m.role === '操作人員' && m.active);

  return (
    <>
      <h1>{me.workspaces?.name ?? '我的公司'}</h1>
      <p className="sub">
        你好，{me.name}（{me.role}）
      </p>
      <Flash searchParams={searchParams} />

      {profile?.privacy_version !== PRIVACY_VERSION && (
        <form className="card" action={acceptPrivacy}>
          <p style={{ marginTop: 0 }}>
            隱私權政策有新版本（或你還沒同意過）。請閱讀<Link href="/privacy">隱私權政策</Link>後按同意。
          </p>
          <button type="submit">我已閱讀並同意</button>
        </form>
      )}

      <div className="grid">
        <div className="card">
          <h2>待處理留言</h2>
          <p style={{ fontSize: 32, margin: 0, fontWeight: 700 }}>{openCount ?? 0}</p>
          <p className="muted">連接社群帳號後，每 15 分鐘自動同步。收件匣畫面會在下一階段接上。</p>
        </div>
        <div className="card">
          <h2>社群帳號</h2>
          <p style={{ fontSize: 32, margin: 0, fontWeight: 700 }}>
            {connected} <span className="muted">/ {accounts?.length ?? 0} 已連接</span>
          </p>
          <Link href="/settings/social">前往設定 →</Link>
        </div>
      </div>

      <div className="card">
        <h2>品牌</h2>
        {brands?.length ? (
          <ul className="clean">
            {brands.map((b) => (
              <li key={b.id}>{b.name}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">{isAdmin ? '還沒有品牌，先新增一個吧。' : '你目前沒有被指派任何品牌，請聯絡管理員。'}</p>
        )}
        {isAdmin && (
          <form action={createBrand} className="row" style={{ marginTop: 12 }}>
            <div>
              <label htmlFor="brand-name">新增品牌</label>
              <input id="brand-name" name="name" type="text" maxLength={60} required placeholder="品牌名稱" />
            </div>
            <button type="submit">新增</button>
          </form>
        )}
      </div>

      <div className="card">
        <h2>團隊成員</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名字</th>
                <th>角色</th>
                <th>負責品牌</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.name}
                    <div className="muted">{m.email}</div>
                  </td>
                  <td>{m.role}</td>
                  <td>
                    {m.role !== '操作人員'
                      ? '全部'
                      : (m.member_brands ?? []).map((mb: any) => brandName.get(mb.brand_id) + (mb.is_lead ? '（負責人）' : '')).join('、') || '—'}
                  </td>
                  <td>
                    {!m.active ? (
                      <span className="tag">已停用</span>
                    ) : m.user_id ? (
                      <span className="tag ok">已加入</span>
                    ) : (
                      <span className="tag warn">等待註冊</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isAdmin && (
          <>
            <form action={inviteMember} style={{ marginTop: 16 }}>
              <h2>邀請成員</h2>
              <div className="row">
                <div>
                  <label htmlFor="inv-email">Email</label>
                  <input id="inv-email" name="email" type="email" required />
                </div>
                <div>
                  <label htmlFor="inv-name">名字</label>
                  <input id="inv-name" name="name" type="text" maxLength={40} required />
                </div>
                <div>
                  <label htmlFor="inv-role">角色</label>
                  <select id="inv-role" name="role" defaultValue="操作人員">
                    <option>操作人員</option>
                    <option>主管</option>
                    <option>管理員</option>
                  </select>
                </div>
                <button type="submit">加入名單</button>
              </div>
              <p className="muted">目前不會自動寄信，請自己通知對方用這個 email 註冊。</p>
            </form>

            {operators.length > 0 && (brands?.length ?? 0) > 0 && (
              <form action={assignBrand} style={{ marginTop: 16 }}>
                <h2>指派品牌給操作人員</h2>
                <div className="row">
                  <div>
                    <label htmlFor="as-m">成員</label>
                    <select id="as-m" name="member_id">
                      {operators.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="as-b">品牌</label>
                    <select id="as-b" name="brand_id">
                      {(brands ?? []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="check" style={{ flex: '0 0 auto' }}>
                    <input type="checkbox" name="is_lead" value="yes" /> 品牌負責人
                  </label>
                  <button type="submit">指派</button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </>
  );
}
