import Link from 'next/link';
import { Flash, type SearchParams } from '@/components/Flash';
import { requireUser } from '@/lib/workspace';
import { serverReady } from '@/lib/env';
import { updateProfile } from './actions';
import { DeleteAccountForm } from './DeleteAccountForm';

export default async function AccountSettings({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, privacy_version, privacy_accepted_at')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <>
      <h1>帳號設定</h1>
      <p className="sub">{user.email}</p>
      <Flash searchParams={searchParams} />

      <form className="card" action={updateProfile}>
        <h2>個人資料</h2>
        <label htmlFor="dn">暱稱</label>
        <input id="dn" name="display_name" type="text" maxLength={40} defaultValue={profile?.display_name ?? ''} />
        <p className="muted">
          隱私權政策：
          {profile?.privacy_accepted_at
            ? `已於 ${new Date(profile.privacy_accepted_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} 同意（版本 ${profile.privacy_version}）`
            : '尚未同意'}
          　<Link href="/privacy">查看政策</Link>
        </p>
        <button type="submit">儲存</button>
      </form>

      <div className="card">
        <h2>刪除帳號</h2>
        <p>刪除後無法復原：</p>
        <ul>
          <li>如果公司只有你一個人：公司的社群授權、貼文、留言、回覆、操作紀錄會全部刪除。</li>
          <li>如果公司還有其他成員：只刪除你的個人資料，你的名字會改成「已刪除成員」，公司資料保留給其他人。</li>
          <li>如果你是唯一的管理員但還有其他成員：請先把另一位成員設為管理員。</li>
          <li>為了安全，需要在登入後 15 分鐘內操作。</li>
        </ul>
        {serverReady() ? <DeleteAccountForm /> : <p className="msg error">伺服器尚未設定完成（缺少環境變數），暫時無法刪除。請到 /status 檢查。</p>}
      </div>
    </>
  );
}
