/** 各平台共用的型別 */

export type Platform = 'instagram' | 'youtube';

/** 資料庫 social_accounts 的一列（同步程式需要的欄位） */
export type SocialAccountRow = {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  platform: string;
  external_id: string | null;
  provider_user_id: string | null;
  sync_cursor: Record<string, unknown>;
};

/** 寫進 srv_ingest_comments 的一則留言 */
export type SyncItem = {
  post_external_id: string;
  post_caption?: string;
  post_permalink?: string;
  post_posted_at?: string;
  external_id: string;
  author: string;
  body: string;
  posted_at: string;
};

/** OAuth 換到的 token */
export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes: string[];
};

/** 授權後找到、要存成 social_accounts 的帳號 */
export type DiscoveredAccount = {
  externalId: string;
  handle: string;
  providerUserId: string;
  tokens: OAuthTokens; // 這個帳號實際要用的 token（IG 會是粉專 token）
};

export type SyncContext = {
  account: SocialAccountRow;
  accessToken: string;
  /** 呼叫平台 API 之前先扣配額；回傳 false 代表今天額度已用完，不可以呼叫 */
  consumeQuota: (units: number) => Promise<boolean>;
};

export type SyncResult = { items: SyncItem[]; cursor: Record<string, unknown> };

export interface PlatformAdapter {
  authUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  discoverAccounts(tokens: OAuthTokens): Promise<DiscoveredAccount[]>;
  refresh?(refreshToken: string): Promise<OAuthTokens>;
  fetchComments(ctx: SyncContext): Promise<SyncResult>;
  /** 撤銷授權（刪除帳號時盡力呼叫；失敗不影響刪除） */
  revoke(args: { accessToken: string; refreshToken?: string | null; providerUserId?: string | null }): Promise<void>;
}

/** 平台 API 錯誤：tokenExpired → 標記「授權已過期」；rateLimited → 退避重試 */
export class PlatformError extends Error {
  constructor(
    message: string,
    public tokenExpired = false,
    public rateLimited = false,
  ) {
    super(message);
  }
}

/** 共用：帶逾時的 fetch，避免某個平台卡住拖垮整批同步 */
export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 10_000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 回應 */
  }
  return { res, json };
}
