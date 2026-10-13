'use server';
/** 登入／註冊（Supabase Auth 內建防暴力破解的頻率限制） */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { backWith } from '@/lib/workspace';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function translate(message: string) {
  if (/invalid login credentials/i.test(message)) return '帳號或密碼錯誤';
  if (/email not confirmed/i.test(message)) return '請先到信箱點擊確認連結';
  if (/already registered|already been registered/i.test(message)) return '這個 email 已經註冊過，請直接登入';
  if (/rate limit|too many/i.test(message)) return '嘗試太多次，請稍後再試';
  if (/password/i.test(message)) return '密碼不符合規則（至少 8 個字元）';
  return '發生錯誤，請稍後再試';
}

function readForm(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  return { email, password };
}

export async function login(formData: FormData) {
  const { email, password } = readForm(formData);
  if (!EMAIL.test(email) || !password) backWith('/login', '請輸入 email 和密碼', 'error');
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) backWith('/login', translate(error.message), 'error');
  redirect('/app');
}

export async function signup(formData: FormData) {
  const { email, password } = readForm(formData);
  if (!EMAIL.test(email)) backWith('/login', 'email 格式不正確', 'error');
  if (password.length < 8) backWith('/login', '密碼至少 8 個字元', 'error');

  const h = await headers();
  const origin = process.env.APP_URL || h.get('origin') || '';
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) backWith('/login', translate(error.message), 'error');
  // Supabase 若關閉「Confirm email」會直接登入；開啟時要先去收信
  if (data.session) redirect('/onboarding');
  backWith('/login', '註冊成功！請到信箱點擊確認連結，再回來登入');
}
