// 產生加密金鑰與 CRON_SECRET：在終端機執行  node scripts/gen-keys.mjs
// 產生的值只貼到 Vercel 環境變數（和你自己的 .env.local），不要傳給任何人、不要 commit 到 GitHub
import { randomBytes } from 'node:crypto';

console.log('TOKEN_ENC_KEYS=1:' + randomBytes(32).toString('base64'));
console.log('TOKEN_ENC_CURRENT=1');
console.log('CRON_SECRET=' + randomBytes(32).toString('base64url'));
console.log('\n⚠ 金鑰遺失＝已存的 token 全部解不開（只能請使用者重新連接）。請另外存一份在密碼管理器。');
