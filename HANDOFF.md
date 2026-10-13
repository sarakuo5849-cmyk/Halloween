# 交接文件：社群經營工作台（給新聊天室的 Claude）

> 使用方式：把這個資料夾（或 zip）上傳到新聊天室，並說：「請先讀 HANDOFF.md，接著從『下一步』繼續。」

## 1. 使用者與專案
- 使用者：萱（高中生），組織 FIGHT.K，Windows 電腦；已有 GitHub、Vercel；剛登入 Supabase。偏好繁體中文、白話、一步一步，不喜歡太長太難懂的文件。
- 專案：「社群經營工作台」——多品牌社群留言管理，含 AI 回覆、品牌問卷、IG/FB/YouTube/Google 連接、角色權限、AI 小助手。
- 最終目標：能綁定所有社群平台與 AI，完整上架給使用者使用，並有完整資料儲存。
- 目前沒有：Meta 開發者帳號、客戶的 IG 測試帳號、AI API 金鑰（之後用客戶的帳號與金鑰測試）。Meta 開發者資格（年齡／簽署）未確認；選哪家 AI、資料保存期限、預算時程都未決定。

## 2. 安全規則（必守）
- 絕不要求或接受使用者貼 Supabase 資料庫密碼、`service_role` key、任何真實 API 金鑰、token。只可請對方提供 Project URL 與 anon public key（公開值）。
- 原型中凡是模擬的功能都要照實標示，不可假裝成功。

## 3. 已完成（截至「請幫我修改 讓他可以順利運作」之前）
### 前端原型 `social-workbench-v3.html`（單一 HTML、原生 JS，資料全在記憶體）
- 修正中文輸入法搜尋被打斷的 bug。
- 品牌問卷：客人族群、個性、稱呼、AI 不可答應的事 都有「其他」＋文字欄（200 字上限，選項代碼與文字分開存，取消選「其他」時文字保留但隱藏）。
- AI 供應商「其他（自訂）」：供應商名稱、模型、API 位址（僅 https、擋本機/內網位址）、金鑰；5 種模擬連線結果（成功/連不到/憑證錯誤/模型不可用/超額），未測試成功的 AI 不會被用來回覆。
- 「社群帳號連接」頁：各平台狀態卡（IG 貼文/Reels、廣告需查證、FB 粉專尚未設定、FB 社團目前不支援並寫原因、YouTube 尚未設定、Google 商家開發中），既有 IG 連接流程保留（模擬）。
- 相似留言一次回：逐則編輯 → 預覽 → 輸入「送出 N 則」確認；上限 20；操作人員預設不可用，管理員可開放；送出的是修改後文字。
- 各品牌社群洞察：由留言即時計算；「全部品牌」只統計有權限品牌；有「展示資料」標示與空狀態。
- 角色首頁（管理員/主管/操作人員）、品牌負責人標記、示範用「切換身分」。
- AI 小助手：右下角按鈕、側邊面板（手機全螢幕）；L0 回答與導覽、L1 預填不送出、L2 確認卡執行（模擬）、L3 拒絕（刪除、替使用者送回覆、顯示金鑰、改權限）；需已測試成功的 AI 才可用，否則顯示固定教學；目前回答來自內建說明，沒有真的呼叫 AI。
- 響應式：<640 手機（收件匣列表/內容分頁、44px 觸控）、640–1024 平板；已用 Playwright 測試無橫向捲動。
- 程式結構備忘：狀態物件 `S`；各頁 `vHome/vInbox/vBatch/vDash/vInsight/vUsage/vBrands/vBrand/vWizard/vIG/vAI/vTeam/vRules/vLog`；`ACT` 以 `data-act` 分派點擊（注意 key 不可重名，曾因 `bedit` 重名出錯）；`onIn` 處理 `data-in` 輸入；modal 用 `openModal/renderModal`；`Q` 為問卷題目；`PROV`/`TESTR`/`urlCheck` 為 AI 供應商；`NAVG` 為導覽。

### 資料庫 `backend/`（Supabase / PostgreSQL）
- `schema.sql`：16 張表（workspaces、members、brands、member_brands[含 is_lead]、brand_profiles、brand_configs、kb_items、social_accounts、social_account_secrets、ai_providers、ai_provider_secrets、brand_ai、comments、replies、audit_log、ai_usage），全部啟用並強制 RLS。
  - 隔離：跨公司互看不到；操作人員只看被指派品牌；管理員/主管看全部。
  - 金鑰與 token 表沒有任何前端權限（只有伺服器 service_role 能用）。
  - 留言只能由伺服器新增；留言原文不可改；回覆須本人名義且不能自標 sent；audit_log 只增不改不刪；至少保留一位管理員；資料不可搬到別公司。
  - RPC：`create_workspace(name, my_name)`、`claim_invites()`。
- `rls_test.sh` + `test_stub.sql`：本機 PostgreSQL 16 模擬 Supabase 登入，39 項權限測試全過，schema 可重複執行。
- 註：Supabase SQL Editor 會誤報「破壞性操作」（因 drop policy/trigger）與「未啟用 RLS」（舊版用迴圈啟用）。已改成逐表明確寫出 RLS；若仍跳視窗，點「運行並啟用 RLS」即可。本包內的 schema.sql 是這個修正後的版本。

## 4. 尚未完成
1. 使用者需在 Supabase 建專案並執行 `schema.sql`（尚未確認是否成功），再提供 Project URL 與 anon key。
2. 前端接上資料庫：真實登入、建立公司/邀請成員、讀寫各表，取代記憶體資料；「品牌負責人」勾選欄位。
3. 伺服器端（Vercel / Supabase Edge Functions）：AI 與社群金鑰加密儲存、真實呼叫 OpenAI/Claude/Gemini/自訂供應商（含伺服器端 SSRF 防護）、用量與備援、小助手改真 AI。
4. 社群串接：Meta（IG/FB 粉專，需開發者帳號、企業驗證、App Review、Webhook、回覆 API）、YouTube（Google OAuth 審核）、Google 商家評論；廣告留言需查證；FB 社團不支援。
5. 回覆真的發送到平台（失敗重試、不重複送出）；報表/洞察改用真實資料；即時更新與通知。
6. 上線整備：隱私權政策、服務條款、資料刪除說明頁、錯誤監控、資料保存期限與備份、真機測試、網域、收費（如需要）。
- 建議順序：後端（資料庫/登入/權限/加密）→ 第一個 AI → 同步啟動 Meta 審核準備 → 用測試帳號完成 IG/FB → YouTube/Google → 上線整備。

## 5. 下一步（新聊天室請從這裡開始）
1. 先問使用者：schema.sql 是否已在 Supabase 成功執行？是否有紅色錯誤？
2. 取得 Project URL 與 anon public key（再次提醒不要貼 service_role key／資料庫密碼）。
3. 把 `social-workbench-v3.html` 改成 Supabase 登入＋資料讀寫（建議分階段：先登入與公司/成員，再品牌與問卷，再留言與回覆），每階段用測試驗證；沒有真實後端可測時要說明哪些部分未經真實驗證。

## 6. 相關規格文件（claude.ai 文件）
- v3 修訂版完整規格（權威）：https://claude.ai/code/artifact/5c330cb3-2e4e-45a3-93d0-7c3310b3aa5a
- v3 摘要：https://claude.ai/code/artifact/31583402-2ecb-4382-8d32-b54066042dde
- 重點決策：3 個角色（品牌負責人是標記）；5 種功能狀態標籤（可用／僅介面展示用／等待授權／開發中／目前不支援＋原因）；連接狀態機（未設定→等待授權→已連接→同步中/同步失敗→授權已過期→已解除）；小助手權限 L0–L3；問卷「其他」200 字；一次回上限 20 且需輸入「送出 N 則」。

## 7. 2026-10-12 更新：後端 v2（本包）
- 使用者選擇「延用 v1 公司／成員／品牌架構」；schema.sql 尚未在 Supabase 執行過。
- schema.sql v2：新增 profiles（＝users，個資法同意紀錄）、posts、social_accounts 同步欄位（external_id、provider_user_id、next_sync_at、sync_cursor、fail_count）、api_quota_usage、data_deletion_requests；secrets 表只接受 `v1:` 加密格式。
- 伺服器專用函式（只授權 service_role）：srv_try_consume_quota、srv_claim_sync_batch（skip locked＋10 分鐘租約）、srv_finish_sync（15 分鐘／指數退避）、srv_ingest_comments、srv_deletion_plan、srv_delete_user_data、srv_delete_by_provider_user、srv_purge_old_comments。
- Next.js：lib/crypto/tokens.ts（AES-256-GCM＋AAD＋金鑰輪替）、OAuth start/callback（IG via Facebook Login、YouTube）、Server Action 刪除帳號、Meta 資料刪除回呼、/api/cron/sync-comments（CRON_SECRET）。
- 排程：Vercel Hobby Cron 只能一天一次，改用 Supabase pg_cron＋pg_net 每 15 分鐘呼叫（cron_setup.sql，未經實測）。
- 測試：82 項資料庫測試、7 項加密測試、tsc 全過。Meta/YouTube 真實 API 未驗證。
- 下一步：使用者執行 schema.sql 並回報 → 前端改 Next.js＋Supabase 登入。
- 2026-10-12 修正：使用者 Supabase 已有 v1 的表，v2 執行時出現 `column next_sync_at does not exist`。已在 schema.sql 加入「從 v1 升級」區塊（add column if not exists、改名 encrypted_token、換掉部分唯一索引、replies FK 改 no action）；全新／升級／半途失敗後重跑三種情況都測過，82 項測試全過。

## 8. 2026-10-13：第一階段網站（GitHub 用專案）
- 使用者已在 Supabase 成功執行 schema.sql v2。
- 建立完整 Next.js 16.4 專案（proxy.ts 取代 middleware；全站 force-dynamic）：/login（註冊登入）、/auth/callback、/auth/signout、/onboarding（claim_invites → create_workspace ＋ 隱私同意紀錄）、/app（品牌、邀請成員、指派品牌、待處理數、補同意隱私）、/settings/social（平台狀態、OAuth 連接按鈕、解除連接＝連動刪除）、/settings/account（暱稱、刪除帳號）、/goodbye、/privacy（草稿）、/data-deletion（確認碼查詢）、/status（環境變數與資料庫檢查，只顯示有／無）。原型放在 public/prototype.html。
- 已驗證：next build、tsc、82 項 DB 測試、7 項加密測試、無／假環境變數下的導頁與 401。未驗證：真實 Supabase 登入流程。
- 下一步：使用者上傳 GitHub → Vercel 部署 → 設定 Auth URL → /status 檢查 → 註冊並建立公司 → 之後把收件匣／回覆畫面從原型搬進 Next.js。
