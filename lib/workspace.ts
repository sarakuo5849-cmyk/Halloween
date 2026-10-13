/** 頁面共用：確認登入、找出目前所屬公司與角色 */
import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseReady } from '@/lib/env';

export type Role = '管理員' | '主管' | '操作人員';
export type Member = { id: string; name: string; role: Role; workspace_id: string; workspaces: { id: string; name: string } | null };

/** 一定要登入；沒登入導到 /login */
export async function requireUser() {
  if (!supabaseReady()) redirect('/status');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return { supabase, user };
}

/** 一定要是某間公司的成員；還沒有公司導到 /onboarding */
export async function requireMember() {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from('members')
    .select('id, name, role, workspace_id, workspaces(id, name)')
    .eq('user_id', user.id)
    .eq('active', true)
    .order('created_at')
    .limit(1);
  const me = (data?.[0] ?? null) as unknown as Member | null;
  if (!me) redirect('/onboarding');
  return { supabase, user, me, workspaceId: me.workspace_id, isAdmin: me.role === '管理員' };
}

/** Server Action 用：把結果訊息帶回頁面（用網址參數，不需要前端 JS） */
export function backWith(path: string, msg: string, kind: 'ok' | 'error' = 'ok'): never {
  redirect(`${path}?${kind}=${encodeURIComponent(msg)}`);
}
