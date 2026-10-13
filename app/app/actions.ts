'use server';
/**
 * 首頁上的操作。每個動作都「以使用者身分」寫入資料庫，
 * 就算有人繞過畫面直接呼叫，RLS 也只允許有權限的人成功（例如只有管理員能新增品牌）。
 */
import { revalidatePath } from 'next/cache';
import { backWith, requireMember } from '@/lib/workspace';
import { PRIVACY_VERSION } from '@/lib/privacy';

const ROLES = ['管理員', '主管', '操作人員'] as const;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f-]{36}$/i;

async function log(supabase: any, workspaceId: string, actor: string, action: string, detail: string) {
  await supabase.from('audit_log').insert({ workspace_id: workspaceId, actor, action, detail });
}

export async function createBrand(formData: FormData) {
  const { supabase, me, workspaceId, isAdmin } = await requireMember();
  if (!isAdmin) backWith('/app', '只有管理員可以新增品牌', 'error');
  const name = String(formData.get('name') ?? '').trim();
  if (!name || name.length > 60) backWith('/app', '品牌名稱需要 1–60 個字', 'error');
  const { error } = await supabase.from('brands').insert({ workspace_id: workspaceId, name });
  if (error) backWith('/app', '新增品牌失敗', 'error');
  await log(supabase, workspaceId, me.name, '新增品牌', name);
  revalidatePath('/app');
  backWith('/app', `已新增品牌「${name}」`);
}

export async function inviteMember(formData: FormData) {
  const { supabase, me, workspaceId, isAdmin } = await requireMember();
  if (!isAdmin) backWith('/app', '只有管理員可以邀請成員', 'error');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const name = String(formData.get('name') ?? '').trim();
  const role = String(formData.get('role') ?? '') as (typeof ROLES)[number];
  if (!EMAIL.test(email)) backWith('/app', 'email 格式不正確', 'error');
  if (!name || name.length > 40) backWith('/app', '名字需要 1–40 個字', 'error');
  if (!ROLES.includes(role)) backWith('/app', '請選擇角色', 'error');

  const { error } = await supabase.from('members').insert({
    workspace_id: workspaceId,
    email,
    name,
    role,
    all_brands: role !== '操作人員', // 管理員／主管看全部品牌；操作人員要另外指派
  });
  if (error) backWith('/app', error.code === '23505' ? '這個 email 或名字已經在成員名單裡' : '邀請失敗', 'error');
  await log(supabase, workspaceId, me.name, '邀請成員', `${name}（${role}）`);
  revalidatePath('/app');
  backWith('/app', `已加入名單。請 ${name} 用 ${email} 註冊登入，就會自動加入公司`);
}

export async function assignBrand(formData: FormData) {
  const { supabase, me, workspaceId, isAdmin } = await requireMember();
  if (!isAdmin) backWith('/app', '只有管理員可以指派品牌', 'error');
  const memberId = String(formData.get('member_id') ?? '');
  const brandId = String(formData.get('brand_id') ?? '');
  if (!UUID.test(memberId) || !UUID.test(brandId)) backWith('/app', '請選擇成員和品牌', 'error');
  const { error } = await supabase
    .from('member_brands')
    .upsert({ member_id: memberId, brand_id: brandId, is_lead: formData.get('is_lead') === 'yes' });
  if (error) backWith('/app', '指派失敗', 'error');
  await log(supabase, workspaceId, me.name, '指派品牌', `${memberId.slice(0, 8)} → ${brandId.slice(0, 8)}`);
  revalidatePath('/app');
  backWith('/app', '已指派品牌');
}

/** 被邀請加入的人沒有經過「建立公司」那一步，在這裡補同意隱私權政策 */
export async function acceptPrivacy() {
  const { supabase, user } = await requireMember();
  await supabase
    .from('profiles')
    .update({ privacy_version: PRIVACY_VERSION, privacy_accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', user.id);
  revalidatePath('/app');
  backWith('/app', '已記錄你的同意');
}
