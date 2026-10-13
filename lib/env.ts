/** 檢查環境變數有沒有設定（只回傳有／沒有，絕不回傳值本身） */
import 'server-only';

const has = (k: string) => !!process.env[k]?.trim();

export const supabaseReady = () => has('NEXT_PUBLIC_SUPABASE_URL') && has('NEXT_PUBLIC_SUPABASE_ANON_KEY');
export const serverReady = () => supabaseReady() && has('SUPABASE_SERVICE_ROLE_KEY') && encryptionReady();
export const encryptionReady = () => /^\d+:[A-Za-z0-9+/=]{43,}/.test(process.env.TOKEN_ENC_KEYS ?? '');
export const metaReady = () => serverReady() && has('META_APP_ID') && has('META_APP_SECRET') && has('META_GRAPH_VERSION') && has('APP_URL');
export const youtubeReady = () => serverReady() && has('GOOGLE_CLIENT_ID') && has('GOOGLE_CLIENT_SECRET') && has('APP_URL');
export const cronReady = () => (process.env.CRON_SECRET ?? '').length >= 32;

export function envChecklist() {
  return [
    { label: 'Supabase 網址與公開金鑰（NEXT_PUBLIC_SUPABASE_URL / ANON_KEY）', ok: supabaseReady(), required: true },
    { label: '伺服器金鑰（SUPABASE_SERVICE_ROLE_KEY）', ok: has('SUPABASE_SERVICE_ROLE_KEY'), required: true },
    { label: '網站網址（APP_URL）', ok: has('APP_URL'), required: true },
    { label: 'Token 加密金鑰（TOKEN_ENC_KEYS）', ok: encryptionReady(), required: true },
    { label: '排程密碼（CRON_SECRET，至少 32 字）', ok: cronReady(), required: true },
    { label: 'Meta / Instagram（META_APP_ID 等）', ok: metaReady(), required: false },
    { label: 'Google / YouTube（GOOGLE_CLIENT_ID 等）', ok: youtubeReady(), required: false },
  ];
}
