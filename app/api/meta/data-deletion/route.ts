/**
 * Meta「資料刪除回呼」（Data Deletion Request Callback）
 * Meta App Review 要求：使用者在 Facebook 設定中移除你的 App 並要求刪除資料時，Meta 會 POST 到這裡。
 * 在 Meta 開發者後台 → App 設定 → 「資料刪除要求網址」填：https://你的網域/api/meta/data-deletion
 *
 * 1. 用 App Secret 驗證 signed_request 簽章（確認真的是 Meta 發的）
 * 2. 刪除該使用者授權的所有 IG/FB 帳號（連動刪除 token、貼文、留言）
 * 3. 回傳查詢網址＋確認碼（格式是 Meta 規定的）
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

function parseSignedRequest(signed: string, appSecret: string): { user_id?: string } | null {
  const [sigPart, payloadPart] = signed.split('.', 2);
  if (!sigPart || !payloadPart) return null;
  const expected = createHmac('sha256', appSecret).update(payloadPart).digest();
  const got = Buffer.from(sigPart, 'base64url');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    return payload?.algorithm?.toUpperCase() === 'HMAC-SHA256' ? payload : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 500 });

  const form = await req.formData().catch(() => null);
  const payload = parseSignedRequest(String(form?.get('signed_request') ?? ''), secret);
  if (!payload?.user_id) return NextResponse.json({ error: 'invalid signed_request' }, { status: 400 });

  const admin = createAdminClient();
  const { data: code, error } = await admin.rpc('srv_delete_by_provider_user', {
    p_platforms: ['instagram', 'facebook'],
    p_provider_user_id: String(payload.user_id),
  });
  if (error || !code) return NextResponse.json({ error: 'failed' }, { status: 500 });

  return NextResponse.json({
    url: `${process.env.APP_URL}/data-deletion?code=${code}`, // 之後做一個頁面讓使用者用確認碼查詢
    confirmation_code: code,
  });
}
