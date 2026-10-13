'use server';
import { redirect } from 'next/navigation';
import { backWith, requireUser } from '@/lib/workspace';
import { PRIVACY_VERSION } from '@/lib/privacy';

/** 第一次使用：建立公司，自己成為管理員；同時記錄「同意隱私權政策」 */
export async function createWorkspace(formData: FormData) {
  const { supabase, user } = await requireUser();
  const company = String(formData.get('company') ?? '').trim();
  const myName = String(formData.get('my_name') ?? '').trim();
  if (!company || company.length > 80) backWith('/onboarding', '公司名稱需要 1–80 個字', 'error');
  if (!myName || myName.length > 40) backWith('/onboarding', '你的名字需要 1–40 個字', 'error');
  if (formData.get('consent') !== 'yes') backWith('/onboarding', '請先閱讀並同意隱私權政策', 'error');

  const { error } = await supabase.rpc('create_workspace', { p_name: company, p_my_name: myName });
  if (error) backWith('/onboarding', '建立失敗：' + (error.code === '23505' ? '名稱重複' : '請稍後再試'), 'error');

  await supabase
    .from('profiles')
    .update({ display_name: myName, privacy_version: PRIVACY_VERSION, privacy_accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', user.id);
  redirect('/app?ok=' + encodeURIComponent('公司建立完成！'));
}
