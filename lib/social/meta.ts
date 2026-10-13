/**
 * Instagram（透過 Facebook 登入 + Graph API；IG 必須是「商業／創作者帳號」並連結 FB 粉專）
 * 頻率限制：Meta 用動態額度（Business Use Case），會在回應 header 告訴你用了多少 %。
 *   這裡的做法：每次呼叫後讀 header，任一指標 ≥ 80% 就停止本輪同步，等下一輪。
 * 建議：正式上線後改用 Webhook 即時接收新留言，輪詢只當備援（更省額度）。
 * ⚠ 尚未用真實 Meta App 驗證；需要開發者帳號、App Review（instagram_manage_comments 等權限）。
 */
import 'server-only';
import { createHmac } from 'node:crypto';
import { fetchJson, PlatformError, type PlatformAdapter, type SyncItem, type OAuthTokens } from './types';

const SCOPES = ['instagram_basic', 'instagram_manage_comments', 'pages_show_list', 'pages_read_engagement'];
const MEDIA_PER_SYNC = 10; // 每次只看最近 10 篇貼文
const USAGE_STOP = 80; // 額度用到 80% 就停

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`缺少環境變數 ${name}`);
  return v;
}
// Graph API 版本請到 Meta 開發者文件 Changelog 確認最新版，填在環境變數（例如 v24.0）
const graph = () => `https://graph.facebook.com/${env('META_GRAPH_VERSION')}`;

/** appsecret_proof：證明呼叫來自持有 App Secret 的伺服器，token 被偷也較難濫用 */
const proof = (token: string) => createHmac('sha256', env('META_APP_SECRET')).update(token).digest('hex');

function withToken(url: string, token: string) {
  const u = new URL(url);
  u.searchParams.set('access_token', token);
  u.searchParams.set('appsecret_proof', proof(token));
  return u.toString();
}

/** 讀 Meta 回傳的用量 header，回傳最高百分比 */
function usagePercent(res: Response): number {
  let max = 0;
  for (const h of ['x-app-usage', 'x-business-use-case-usage', 'x-ad-account-usage']) {
    const raw = res.headers.get(h);
    if (!raw) continue;
    try {
      const walk = (o: any): void => {
        if (typeof o === 'number') max = Math.max(max, o);
        else if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => k !== 'type' && k !== 'estimated_time_to_regain_access' && walk(v));
      };
      walk(JSON.parse(raw));
    } catch {
      /* 忽略格式異常 */
    }
  }
  return max;
}

function check(res: Response, json: any) {
  if (res.ok && !json?.error) return;
  const code = json?.error?.code;
  if (code === 190) throw new PlatformError('Meta 授權失效或已過期', true);
  if ([4, 17, 32, 613, 80002].includes(code)) throw new PlatformError('Meta 頻率限制', false, true);
  throw new PlatformError(`Meta API 錯誤 ${res.status} code=${code ?? '?'}`);
}

export const instagram: PlatformAdapter = {
  authUrl(state, redirectUri) {
    const p = new URLSearchParams({
      client_id: env('META_APP_ID'),
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: SCOPES.join(','),
    });
    return `https://www.facebook.com/${env('META_GRAPH_VERSION')}/dialog/oauth?${p}`;
  },

  async exchangeCode(code, redirectUri) {
    // 1) code → 短效 token
    const p1 = new URLSearchParams({ client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET'), redirect_uri: redirectUri, code });
    const a = await fetchJson(`${graph()}/oauth/access_token?${p1}`);
    check(a.res, a.json);
    // 2) 短效 → 長效使用者 token（約 60 天）
    const p2 = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: env('META_APP_ID'),
      client_secret: env('META_APP_SECRET'),
      fb_exchange_token: a.json.access_token,
    });
    const b = await fetchJson(`${graph()}/oauth/access_token?${p2}`);
    check(b.res, b.json);
    return {
      accessToken: b.json.access_token,
      expiresAt: b.json.expires_in ? new Date(Date.now() + b.json.expires_in * 1000) : null,
      scopes: SCOPES,
    } satisfies OAuthTokens;
  },

  async discoverAccounts(tokens) {
    const me = await fetchJson(withToken(`${graph()}/me?fields=id`, tokens.accessToken));
    check(me.res, me.json);
    const pages = await fetchJson(
      withToken(`${graph()}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}`, tokens.accessToken),
    );
    check(pages.res, pages.json);
    // 用長效使用者 token 換到的「粉專 token」不會過期，拿它來讀 IG 留言
    return (pages.json?.data ?? [])
      .filter((pg: any) => pg.instagram_business_account?.id && pg.access_token)
      .map((pg: any) => ({
        externalId: pg.instagram_business_account.id,
        handle: '@' + (pg.instagram_business_account.username ?? pg.name),
        providerUserId: me.json.id,
        tokens: { accessToken: pg.access_token, expiresAt: null, scopes: tokens.scopes },
      }));
  },

  async fetchComments({ account, accessToken, consumeQuota }) {
    const items: SyncItem[] = [];
    if (!(await consumeQuota(1))) throw new PlatformError('今日 Instagram 同步上限已到', false, true);
    const media = await fetchJson(
      withToken(`${graph()}/${account.external_id}/media?fields=id,caption,permalink,timestamp,comments_count&limit=${MEDIA_PER_SYNC}`, accessToken),
    );
    check(media.res, media.json);
    if (usagePercent(media.res) >= USAGE_STOP) throw new PlatformError('Meta 額度已用 80%，下輪再同步', false, true);

    for (const m of media.json?.data ?? []) {
      if (!m.comments_count) continue; // 沒留言就不浪費呼叫
      if (!(await consumeQuota(1))) break;
      const c = await fetchJson(withToken(`${graph()}/${m.id}/comments?fields=id,text,username,timestamp&limit=50`, accessToken));
      check(c.res, c.json);
      for (const cm of c.json?.data ?? []) {
        items.push({
          post_external_id: m.id,
          post_caption: m.caption ?? '',
          post_permalink: m.permalink,
          post_posted_at: m.timestamp,
          external_id: cm.id,
          author: cm.username ?? '（匿名）',
          body: cm.text ?? '',
          posted_at: cm.timestamp,
        });
      }
      if (usagePercent(c.res) >= USAGE_STOP) break; // 留著已抓到的，剩下的下輪再說
    }
    return { items, cursor: { lastRunAt: new Date().toISOString() } };
  },

  async revoke({ providerUserId }) {
    if (!providerUserId) return;
    // 用 App token 撤銷該使用者對本 App 的全部授權
    const appToken = `${env('META_APP_ID')}|${env('META_APP_SECRET')}`;
    await fetchJson(`${graph()}/${providerUserId}/permissions?access_token=${encodeURIComponent(appToken)}`, { method: 'DELETE' });
  },
};
