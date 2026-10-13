/**
 * 每 15 分鐘由 Supabase pg_cron 呼叫（見 supabase/cron_setup.sql）
 * 只接受帶正確 CRON_SECRET 的請求，其他人打這個網址只會拿到 401。
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { runCommentSync } from '@/lib/sync/run-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 秒；同步程式自己在 45 秒收工，留緩衝

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false; // 沒設定或太短一律拒絕
  const got = req.headers.get('authorization') ?? '';
  // 先 hash 再比對：長度一致，且用固定時間比較，避免被逐字猜出
  const a = createHash('sha256').update(got).digest();
  const b = createHash('sha256').update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const summary = await runCommentSync();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error('[cron] sync failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const POST = handle; // pg_net 用 POST
export const GET = handle; // 手動測試或 Vercel Cron 用 GET
