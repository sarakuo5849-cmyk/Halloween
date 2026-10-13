import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Flash, type SearchParams } from '@/components/Flash';
import { requireUser } from '@/lib/workspace';
import { createWorkspace } from './actions';

export default async function Onboarding({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, user } = await requireUser();

  // 被邀請的人：把「同 email 的邀請」綁到自己帳號，綁到了就直接進首頁
  await supabase.rpc('claim_invites');
  const { data: mine } = await supabase.from('members').select('id').eq('user_id', user.id).eq('active', true).limit(1);
  if (mine?.length) redirect('/app');

  return (
    <div className="narrow">
      <h1>建立你的公司</h1>
      <p className="sub">你會成為這間公司的管理員，之後可以邀請同事、新增品牌。</p>
      <Flash searchParams={searchParams} />
      <form className="card" action={createWorkspace}>
        <label htmlFor="company">公司／團隊名稱</label>
        <input id="company" name="company" type="text" maxLength={80} required placeholder="例如：FIGHT.K" />
        <label htmlFor="my_name">你的名字（同事會看到）</label>
        <input id="my_name" name="my_name" type="text" maxLength={40} required />
        <label className="check">
          <input type="checkbox" name="consent" value="yes" required />
          <span>
            我已閱讀並同意<Link href="/privacy" target="_blank">隱私權政策</Link>
          </span>
        </label>
        <p />
        <button type="submit">建立公司</button>
      </form>
      <p className="muted">
        如果你是被邀請的，請確認登入的 email（{user.email}）和邀請你的 email 相同；不同的話請請管理員重新邀請。
      </p>
    </div>
  );
}
