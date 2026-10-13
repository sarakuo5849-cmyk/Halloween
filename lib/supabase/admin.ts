/**
 * 伺服器專用 Supabase 用戶端（service_role / secret key）
 * ⚠ 這把金鑰可以繞過所有 RLS，只能在伺服器程式（Route Handler、Server Action）使用。
 *   - 環境變數名稱「不可以」用 NEXT_PUBLIC_ 開頭（那樣會被打包進前端）
 *   - 'server-only' 讓前端元件誤 import 時 build 直接失敗
 */
import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
