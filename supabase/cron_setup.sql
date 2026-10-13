-- =====================================================================
-- 每 15 分鐘批次同步留言（用 Supabase 內建的 pg_cron + pg_net，免費方案可用）
--
-- 為什麼不用 Vercel Cron？Vercel 免費（Hobby）方案的 Cron 最多「一天一次」，
-- 寫 */15 會部署失敗。所以改由 Supabase 每 15 分鐘「敲門」呼叫我們在 Vercel 上的 API。
--
-- 執行前：
--   1. 先部署 Next.js 到 Vercel，拿到網址（例如 https://your-app.vercel.app）
--   2. 在 Vercel 環境變數設定 CRON_SECRET（一串隨機字，見 README）
--   3. Supabase 後台 → Database → Extensions → 開啟 pg_cron 與 pg_net
--   4. 把下面兩個 '<<...>>' 換成你的值，在 SQL Editor 執行
--      ⚠ 這兩個值只貼在你自己的 Supabase SQL Editor，不要貼給任何人（包括 AI）
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 把網址與密碼存在 Vault（加密保存，不會明文寫在排程裡）
-- 若重複執行出現「已存在」錯誤，代表之前存過了，可跳過這兩行；要更新請用 vault.update_secret
select vault.create_secret('<<https://your-app.vercel.app>>', 'app_url');
select vault.create_secret('<<你的 CRON_SECRET>>', 'cron_secret');

-- 先移除同名舊排程（第一次執行時沒有東西可刪）
select cron.unschedule(jobid) from cron.job where jobname = 'sync-comments-every-15-min';

select cron.schedule(
  'sync-comments-every-15-min',
  '*/15 * * * *',                                   -- 每 15 分鐘
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/sync-comments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000                   -- 等最多 60 秒（同步程式自己會在 50 秒內收工）
  );
  $$
);

-- （選用）決定資料保存期限後再打開：每天凌晨 3 點刪除超過 180 天的留言
-- select cron.schedule('purge-old-comments', '0 3 * * *', $$ select public.srv_purge_old_comments(180); $$);

-- 檢查排程有沒有在跑：
--   select * from cron.job;
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
--   select status_code, content, created from net._http_response order by created desc limit 10;
