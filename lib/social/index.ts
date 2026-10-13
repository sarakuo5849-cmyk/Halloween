import 'server-only';
import { instagram } from './meta';
import { youtube } from './youtube';
import type { Platform, PlatformAdapter } from './types';

const ADAPTERS: Record<Platform, PlatformAdapter> = { instagram, youtube };

export function isPlatform(p: string): p is Platform {
  return p in ADAPTERS;
}

export function getAdapter(p: string): PlatformAdapter {
  if (!isPlatform(p)) throw new Error(`不支援的平台：${p}`);
  return ADAPTERS[p];
}

/** 同步用的每日配額上限（自己設的安全上限，低於平台真正上限，留空間給「回覆」） */
export const QUOTA: Record<Platform, { dailyLimit: number; tz: string }> = {
  // YouTube 每天 10,000 units；同步最多用 6,000，剩下留給回覆（每則回覆 50 units）
  youtube: { dailyLimit: Number(process.env.YT_DAILY_SYNC_BUDGET ?? 6000), tz: 'America/Los_Angeles' },
  // Meta 是動態額度（看 header）；這裡只是避免程式出錯狂打 API 的保險絲
  instagram: { dailyLimit: Number(process.env.IG_DAILY_SYNC_BUDGET ?? 20000), tz: 'UTC' },
};
