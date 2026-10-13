'use server';
import { revalidatePath } from 'next/cache';
import { backWith, requireUser } from '@/lib/workspace';

export async function updateProfile(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = String(formData.get('display_name') ?? '').trim();
  if (name.length > 40) backWith('/settings/account', '暱稱最多 40 個字', 'error');
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: name, updated_at: new Date().toISOString() })
    .eq('id', user.id);
  if (error) backWith('/settings/account', '儲存失敗', 'error');
  revalidatePath('/settings/account');
  backWith('/settings/account', '已儲存');
}
