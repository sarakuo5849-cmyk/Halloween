/**
 * YouTube（Google OAuth + YouTube Data API v3）
 * 配額：預設每天 10,000 units，太平洋時間午夜重置。
 *   commentThreads.list / videos.list / channels.list = 1 unit；comments.insert（回覆）= 50 units
 * ⚠ 尚未用真實 Google 專案驗證；正式上線前需通過 Google OAuth 驗證（sensitive scope）。
 */
import 'server-only';
import { fetchJson, PlatformError, type PlatformAdapter, type SyncItem, type OAuthTokens } from './types';

const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl'; // 讀留言＋回覆留言需要這個
const API = 'https://www.googleapis.com/youtube/v3';
const MAX_PAGES = 3; // 每次同步最多翻 3 頁（300 則），控制配額

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`缺少環境變數 ${name}`);
  return v;
}

function toTokens(j: any): OAuthTokens {
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
    scopes: String(j.scope ?? '').split(' ').filter(Boolean),
  };
}

function check(res: Response, json: any) {
  if (res.ok) return;
  const reason = json?.error?.errors?.[0]?.reason ?? '';
  if (res.status === 401) throw new PlatformError('YouTube 授權失效', true);
  if (res.status === 403 && /quota|rateLimit/i.test(reason)) throw new PlatformError('YouTube 配額用完', false, true);
  throw new PlatformError(`YouTube API 錯誤 ${res.status} ${reason}`);
}

export const youtube: PlatformAdapter = {
  authUrl(state, redirectUri) {
    const p = new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline', // 拿 refresh token，才能在背景同步
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  },

  async exchangeCode(code, redirectUri) {
    const { res, json } = await fetchJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env('GOOGLE_CLIENT_ID'),
        client_secret: env('GOOGLE_CLIENT_SECRET'),
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok || !json?.access_token) throw new PlatformError('Google 換取 token 失敗');
    return toTokens(json);
  },

  async refresh(refreshToken) {
    const { res, json } = await fetchJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: env('GOOGLE_CLIENT_ID'),
        client_secret: env('GOOGLE_CLIENT_SECRET'),
        grant_type: 'refresh_token',
      }),
    });
    // invalid_grant＝使用者撤銷授權或 refresh token 過期 → 需要重新連接
    if (!res.ok) throw new PlatformError('Google refresh token 失效', json?.error === 'invalid_grant');
    return toTokens(json);
  },

  async discoverAccounts(tokens) {
    const { res, json } = await fetchJson(`${API}/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    check(res, json);
    return (json?.items ?? []).map((ch: any) => ({
      externalId: ch.id,
      handle: ch.snippet?.customUrl ?? ch.snippet?.title ?? ch.id,
      providerUserId: ch.id,
      tokens,
    }));
  },

  async fetchComments({ account, accessToken, consumeQuota }) {
    const since = typeof account.sync_cursor?.since === 'string' ? Date.parse(account.sync_cursor.since) : 0;
    const items: SyncItem[] = [];
    let pageToken: string | undefined;
    let newest = since;

    for (let page = 0; page < MAX_PAGES; page++) {
      if (!(await consumeQuota(1))) throw new PlatformError('今日 YouTube 同步配額已用完', false, true);
      const p = new URLSearchParams({
        part: 'snippet',
        allThreadsRelatedToChannelId: account.external_id!,
        maxResults: '100',
        order: 'time',
        textFormat: 'plainText',
      });
      if (pageToken) p.set('pageToken', pageToken);
      const { res, json } = await fetchJson(`${API}/commentThreads?${p}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      check(res, json);

      let reachedOld = false;
      for (const t of json?.items ?? []) {
        const c = t.snippet?.topLevelComment;
        const at = Date.parse(c?.snippet?.publishedAt ?? '');
        if (since && at <= since) {
          reachedOld = true; // 依時間排序，遇到舊留言代表後面都同步過了
          break;
        }
        newest = Math.max(newest, at || 0);
        items.push({
          post_external_id: t.snippet.videoId,
          post_permalink: `https://www.youtube.com/watch?v=${t.snippet.videoId}`,
          external_id: c.id,
          author: c.snippet.authorDisplayName ?? '（匿名）',
          body: c.snippet.textDisplay ?? '',
          posted_at: c.snippet.publishedAt,
        });
      }
      pageToken = json?.nextPageToken;
      if (reachedOld || !pageToken) break;
    }

    // 補上影片標題（一次最多 50 支，只花 1 unit）
    const ids = [...new Set(items.map((i) => i.post_external_id))].slice(0, 50);
    if (ids.length && (await consumeQuota(1))) {
      const { res, json } = await fetchJson(`${API}/videos?part=snippet&id=${ids.join(',')}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const titles = new Map<string, any>((json?.items ?? []).map((v: any) => [v.id, v.snippet]));
        for (const i of items) {
          const s = titles.get(i.post_external_id);
          if (s) Object.assign(i, { post_caption: s.title, post_posted_at: s.publishedAt });
        }
      }
    }
    return { items, cursor: { since: newest ? new Date(newest).toISOString() : account.sync_cursor?.since ?? null } };
  },

  async revoke({ accessToken, refreshToken }) {
    // 撤銷 refresh token 會讓整組授權失效
    await fetchJson(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken || accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  },
};
