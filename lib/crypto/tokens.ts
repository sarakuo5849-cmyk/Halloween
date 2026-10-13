/**
 * 社群 Access Token 加密／解密（AES-256-GCM）
 *
 * 為什麼要自己加密，不直接存進 Supabase？
 *  - 資料庫備份外洩、或 service_role key 外洩時，對方只拿到密文；
 *    解密金鑰只放在 Vercel 環境變數，兩邊都被攻破才會外洩。
 *  - GCM 模式附帶「防竄改標籤」：密文被改一個字就會解密失敗。
 *  - context（AAD）把密文綁定到特定帳號：把 A 帳號的密文複製到 B 帳號那列，解密會失敗。
 *
 * 存進資料庫的格式：v{金鑰版本}:{iv}:{tag}:{密文}（都是 base64url）
 * 金鑰輪替：在 TOKEN_ENC_KEYS 加一把新的、把 TOKEN_ENC_CURRENT 改成新版本；
 *          舊資料仍可用舊金鑰解開，下次寫入時就會自動改用新金鑰。
 */
import 'server-only'; // 保險：萬一被前端元件 import，build 會直接失敗
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM 建議 12 bytes，每次加密都隨機產生

type KeyRing = { current: number; keys: Map<number, Buffer> };
let cached: KeyRing | null = null;

/** 讀取環境變數：TOKEN_ENC_KEYS="1:<base64 32 bytes>,2:<base64 32 bytes>"、TOKEN_ENC_CURRENT="2" */
function keyRing(): KeyRing {
  if (cached) return cached;
  const raw = process.env.TOKEN_ENC_KEYS;
  if (!raw) throw new Error('缺少環境變數 TOKEN_ENC_KEYS（用 scripts/gen-keys.mjs 產生）');
  const keys = new Map<number, Buffer>();
  for (const part of raw.split(',')) {
    const [ver, b64] = part.trim().split(':');
    const key = Buffer.from(b64 ?? '', 'base64');
    if (!/^\d+$/.test(ver ?? '') || key.length !== 32) {
      throw new Error('TOKEN_ENC_KEYS 格式錯誤：每把金鑰必須是 版本:base64(32 bytes)');
    }
    keys.set(Number(ver), key);
  }
  const current = Number(process.env.TOKEN_ENC_CURRENT ?? Math.max(...keys.keys()));
  if (!keys.has(current)) throw new Error(`TOKEN_ENC_CURRENT=${current} 找不到對應金鑰`);
  cached = { current, keys };
  return cached;
}

/** 加密。context 建議用 `social_account:<id>:access` 這種固定格式 */
export function encryptToken(plain: string, context: string): string {
  if (!plain) throw new Error('不能加密空字串');
  const { current, keys } = keyRing();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, keys.get(current)!, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [`v${current}`, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':');
}

/** 解密。密文被竄改、金鑰不對、context 不符都會丟出錯誤（錯誤訊息不含任何 token 內容） */
export function decryptToken(blob: string, context: string): string {
  const m = /^v(\d+):([\w-]+):([\w-]+):([\w-]+)$/.exec(blob);
  if (!m) throw new Error('密文格式錯誤');
  const key = keyRing().keys.get(Number(m[1]));
  if (!key) throw new Error(`找不到第 ${m[1]} 版金鑰（輪替時不要刪掉舊金鑰）`);
  try {
    const decipher = createDecipheriv(ALGO, key, Buffer.from(m[2], 'base64url'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(m[3], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(m[4], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('解密失敗：密文可能被竄改或金鑰不符');
  }
}

/** 這筆密文是不是用舊金鑰加密的（金鑰輪替時用來判斷要不要重新加密） */
export function isStaleKey(blob: string): boolean {
  const ver = Number(/^v(\d+):/.exec(blob)?.[1]);
  return ver !== keyRing().current;
}

/** 統一的 context 字串，避免各處拼錯 */
export const tokenContext = (accountId: string, kind: 'access' | 'refresh') => `social_account:${accountId}:${kind}`;

/** 只給測試用：清除快取，讓測試可以換環境變數 */
export function _resetKeyCacheForTests() {
  cached = null;
}
