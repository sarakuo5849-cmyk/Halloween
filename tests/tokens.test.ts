// 執行：npm run test:crypto
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encryptToken, decryptToken, isStaleKey, tokenContext, _resetKeyCacheForTests } from '../lib/crypto/tokens.ts';

const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('base64');
const ctxA = tokenContext('11111111-1111-1111-1111-111111111111', 'access');
const ctxB = tokenContext('22222222-2222-2222-2222-222222222222', 'access');
const useKeys = (keys: string, current: string) => {
  process.env.TOKEN_ENC_KEYS = keys;
  process.env.TOKEN_ENC_CURRENT = current;
  _resetKeyCacheForTests();
};

test('加密後可解密，且密文不含明文', () => {
  useKeys(`1:${k1}`, '1');
  const token = 'EAAG-very-secret-token-測試';
  const enc = encryptToken(token, ctxA);
  assert.match(enc, /^v1:/);
  assert.ok(!enc.includes('secret'));
  assert.equal(decryptToken(enc, ctxA), token);
});

test('同一個 token 每次加密結果都不同（隨機 IV）', () => {
  useKeys(`1:${k1}`, '1');
  assert.notEqual(encryptToken('abc', ctxA), encryptToken('abc', ctxA));
});

test('密文被竄改 → 解密失敗', () => {
  useKeys(`1:${k1}`, '1');
  const enc = encryptToken('abc', ctxA);
  const parts = enc.split(':');
  const ct = Buffer.from(parts[3], 'base64url');
  ct[0] ^= 1;
  parts[3] = ct.toString('base64url');
  assert.throws(() => decryptToken(parts.join(':'), ctxA), /解密失敗/);
});

test('把 A 帳號的密文搬到 B 帳號 → 解密失敗（AAD 綁定）', () => {
  useKeys(`1:${k1}`, '1');
  assert.throws(() => decryptToken(encryptToken('abc', ctxA), ctxB), /解密失敗/);
});

test('錯誤金鑰 → 解密失敗', () => {
  useKeys(`1:${k1}`, '1');
  const enc = encryptToken('abc', ctxA);
  useKeys(`1:${k2}`, '1');
  assert.throws(() => decryptToken(enc, ctxA), /解密失敗/);
});

test('金鑰輪替：舊密文仍可解，新密文用新金鑰', () => {
  useKeys(`1:${k1}`, '1');
  const old = encryptToken('abc', ctxA);
  useKeys(`1:${k1},2:${k2}`, '2');
  assert.equal(decryptToken(old, ctxA), 'abc');
  assert.ok(isStaleKey(old));
  const fresh = encryptToken('abc', ctxA);
  assert.match(fresh, /^v2:/);
  assert.ok(!isStaleKey(fresh));
});

test('金鑰格式錯誤會明確報錯', () => {
  useKeys('1:short', '1');
  assert.throws(() => encryptToken('abc', ctxA), /格式錯誤/);
});
