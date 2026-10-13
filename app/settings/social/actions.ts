'use server';
import { revalidatePath } from 'next/cache';
import { backWith, requireMember } from '@/lib/workspace';

const UUID = /^[0-9a-f-]{36}$/i;

/** 解除連接：刪除這個社群帳號 → 資料庫連動刪除它的 token、貼文、留言 */
export async function disconnectAccount(formData: FormData) {
  const { supabase, me, workspaceId, isAdmin } = await requireMember();
  if (!isAdmin) backWith('/settings/social', '只有管理員可以解除連接', 'error');
  const id = String(formData.get('account_id') ?? '');
  if (!UUID.test(id)) backWith('/settings/social', '參數錯誤', 'error');
  if (formData.get('confirm') !== 'yes') backWith('/settings/social', '請勾選確認', 'error');

  const { data, error } = await supabase
    .from('social_accounts')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('handle, platform');
  if (error || !data?.length) backWith('/settings/social', '解除失敗', 'error');
  await supabase.from('audit_log').insert({
    workspace_id: workspaceId,
    actor: me.name,
    action: '解除社群帳號',
    detail: `${data[0].platform}：${data[0].handle}（已刪除 token、貼文、留言）`,
  });
  revalidatePath('/settings/social');
  backWith('/settings/social', `已解除 ${data[0].handle}，相關資料已刪除`);
}
