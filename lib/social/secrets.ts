/**
 * Token 存取的唯一入口：寫入前加密、讀出後解密。
 * 其他程式不要直接讀寫 social_account_secrets 表。
 * ⚠ 永遠不要 console.log token、不要回傳給前端、不要放進錯誤訊息。
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptToken, encryptToken, tokenContext } from '@/lib/crypto/tokens';
import type { OAuthTokens } from './types';

export async function saveSocialSecret(admin: SupabaseClient, accountId: string, t: OAuthTokens & { keepRefresh?: string | null }) {
  const refresh = t.refreshToken ?? t.keepRefresh ?? null; // Google 刷新時常常不回傳新的 refresh token，沿用舊的
  const { error } = await admin.from('social_account_secrets').upsert({
    account_id: accountId,
    encrypted_access_token: encryptToken(t.accessToken, tokenContext(accountId, 'access')),
    encrypted_refresh_token: refresh ? encryptToken(refresh, tokenContext(accountId, 'refresh')) : null,
    scopes: t.scopes,
    expires_at: t.expiresAt ? t.expiresAt.toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`儲存 token 失敗：${error.code}`); // 只回錯誤代碼，不帶內容
}

export async function loadSocialSecret(admin: SupabaseClient, accountId: string) {
  const { data, error } = await admin
    .from('social_account_secrets')
    .select('encrypted_access_token, encrypted_refresh_token, expires_at')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    accessToken: decryptToken(data.encrypted_access_token, tokenContext(accountId, 'access')),
    refreshToken: data.encrypted_refresh_token ? decryptToken(data.encrypted_refresh_token, tokenContext(accountId, 'refresh')) : null,
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
  };
}
