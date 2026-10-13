#!/bin/bash
# 用法：bash supabase/tests/rls_test.sh   （需要本機 PostgreSQL 16；會建立測試資料庫 rls_t）
set -u
PSQL="psql -h ${PGHOST:-/var/tmp} -p ${PGPORT:-5544} -U postgres -q -t -A"
$PSQL -d postgres -c "drop database if exists rls_t" -c "create database rls_t" >/dev/null 2>&1
DB="$PSQL -d rls_t -v ON_ERROR_STOP=1"
cd "$(dirname "$0")"
$DB -f test_stub.sql >/dev/null || exit 1
# 模擬「之前跑過 v1」：UPGRADE_FROM=v1的schema.sql bash rls_test.sh
if [ -n "${UPGRADE_FROM:-}" ]; then $DB -f "$UPGRADE_FROM" >/dev/null 2>&1 || { echo 'v1 失敗'; exit 1; }; fi
$DB -f ../schema.sql >/dev/null 2>&1 || { echo 'schema 失敗'; exit 1; }
$DB -f ../schema.sql >/dev/null 2>&1 || { echo 'schema 第二次執行失敗（不可重複執行）'; exit 1; }
A=00000000-0000-0000-0000-00000000000a; B=00000000-0000-0000-0000-00000000000b; C=00000000-0000-0000-0000-00000000000c; D=00000000-0000-0000-0000-00000000000d
$DB >/dev/null <<SQL
insert into auth.users values ('$A','a@x.com'),('$B','b@x.com'),('$C','c@x.com'),('$D','d@x.com');
insert into workspaces(id,name) values ('11111111-1111-1111-1111-111111111111','公司甲'),('22222222-2222-2222-2222-222222222222','公司乙');
insert into members(id,workspace_id,user_id,email,name,role,all_brands) values
 ('a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','$A','a@x.com','阿哲','管理員',true),
 ('a0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','$B','b@x.com','Ruby','主管',true),
 ('a0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','$C','c@x.com','小琪','操作人員',false),
 ('a0000000-0000-0000-0000-000000000004','22222222-2222-2222-2222-222222222222','$D','d@x.com','外人','管理員',true);
insert into brands(id,workspace_id,name) values ('b1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','暖屋'),('b2000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','森活'),('b3000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','別家');
insert into member_brands values ('a0000000-0000-0000-0000-000000000003','b2000000-0000-0000-0000-000000000002',false);
insert into comments(id,workspace_id,brand_id,platform,author,body) values
 ('c1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','b1000000-0000-0000-0000-000000000001','instagram','客1','暖屋的留言'),
 ('c2000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','b2000000-0000-0000-0000-000000000002','instagram','客2','森活的留言'),
 ('c3000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','b3000000-0000-0000-0000-000000000003','instagram','客3','別家的留言');
insert into ai_providers(id,workspace_id,kind,label,key_last4) values ('e1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','openai','主力','1234');
insert into ai_provider_secrets values ('e1000000-0000-0000-0000-000000000001','ENC(secret)');
SQL
pass=0; fail=0
# t 描述 使用者 email 預期(ok|err|N列) SQL
t(){ desc="$1"; u="$2"; em="$3"; exp="$4"; q="$5"
  out=$($DB -c "set role authenticated; set request.jwt.claim.sub='$u'; set request.jwt.claim.email='$em'; $q" 2>&1); rc=$?
  if [ "$exp" = err ]; then [ $rc -ne 0 ] && ok=1 || ok=0
  elif [ "$exp" = ok ]; then [ $rc -eq 0 ] && ok=1 || ok=0
  else res=$(echo "$out" | grep -E '^[0-9]+$' | tail -1); [ "$res" = "$exp" ] && ok=1 || ok=0; fi
  if [ $ok = 1 ]; then pass=$((pass+1)); echo "  通過  $desc"; else fail=$((fail+1)); echo "  失敗  $desc  → ${out:0:160}"; fi; }
# sv 描述 預期 SQL：以伺服器（service_role）身分執行
sv(){ desc="$1"; exp="$2"; q="$3"
  out=$($DB -c "set role service_role; set request.jwt.claim.sub=''; $q" 2>&1); rc=$?
  if [ "$exp" = err ]; then [ $rc -ne 0 ] && ok=1 || ok=0
  elif [ "$exp" = ok ]; then [ $rc -eq 0 ] && ok=1 || ok=0
  else res=$(echo "$out" | grep -vE '^(SET)?$' | tail -1); [ "$res" = "$exp" ] && ok=1 || ok=0; fi
  if [ $ok = 1 ]; then pass=$((pass+1)); echo "  通過  $desc"; else fail=$((fail+1)); echo "  失敗  $desc  → ${out:0:200}"; fi; }
# q 描述 預期 SQL：以資料庫擁有者身分檢查結果
q(){ desc="$1"; exp="$2"; res=$($DB -c "$3" 2>&1 | tail -1)
  if [ "$res" = "$exp" ]; then pass=$((pass+1)); echo "  通過  $desc"; else fail=$((fail+1)); echo "  失敗  $desc  → 得到 ${res:0:200}"; fi; }
echo "== 資料隔離 =="
t "操作人員只看得到自己品牌的留言(1)" $C c@x.com 1 "select count(*) from comments"
t "操作人員只看得到自己品牌(1)" $C c@x.com 1 "select count(*) from brands"
t "主管看得到本公司全部留言(2)" $B b@x.com 2 "select count(*) from comments"
t "管理員看不到別公司資料(2)" $A a@x.com 2 "select count(*) from comments"
t "外人只看到自己公司的留言(1)" $D d@x.com 1 "select count(*) from comments"
t "外人看不到公司甲的成員(1)" $D d@x.com 1 "select count(*) from members"
echo "== 金鑰與授權 =="
t "管理員也讀不到 AI 金鑰表" $A a@x.com err "select * from ai_provider_secrets"
t "管理員也不能寫入金鑰表(用戶端)" $A a@x.com err "insert into ai_provider_secrets values ('e1000000-0000-0000-0000-000000000001','x')"
t "管理員讀不到社群 token 表" $A a@x.com err "select * from social_account_secrets"
t "操作人員可看到 AI 名稱(1)" $C c@x.com 1 "select count(*) from ai_providers"
t "操作人員不能新增 AI" $C c@x.com err "insert into ai_providers(workspace_id,kind,label) values ('11111111-1111-1111-1111-111111111111','openai','駭')"
t "自訂 AI 位址必須 https" $A a@x.com err "insert into ai_providers(workspace_id,kind,label,base_url) values ('11111111-1111-1111-1111-111111111111','custom','x','http://evil')"
t "管理員可新增 https 的自訂 AI" $A a@x.com ok "insert into ai_providers(workspace_id,kind,label,base_url) values ('11111111-1111-1111-1111-111111111111','custom','x','https://api.example.com/v1')"
echo "== 角色與權限提升 =="
t "操作人員不能把自己升成管理員" $C c@x.com 0 "update members set role='管理員' where id='a0000000-0000-0000-0000-000000000003'; select 0"
t "操作人員不能新增成員" $C c@x.com err "insert into members(workspace_id,email,name,role) values ('11111111-1111-1111-1111-111111111111','z@x.com','Z','管理員')"
t "主管不能新增品牌" $B b@x.com err "insert into brands(workspace_id,name) values ('11111111-1111-1111-1111-111111111111','新')"
t "管理員可新增品牌" $A a@x.com ok "insert into brands(workspace_id,name) values ('11111111-1111-1111-1111-111111111111','新')"
t "外人不能在公司甲新增品牌" $D d@x.com err "insert into brands(workspace_id,name) values ('11111111-1111-1111-1111-111111111111','入侵')"
t "不能把成員搬到別公司" $A a@x.com err "update members set workspace_id='22222222-2222-2222-2222-222222222222' where id='a0000000-0000-0000-0000-000000000003'"
t "不能刪除唯一的管理員" $A a@x.com err "delete from members where id='a0000000-0000-0000-0000-000000000001'"
t "不能把唯一管理員停用" $A a@x.com err "update members set active=false where id='a0000000-0000-0000-0000-000000000001'"
echo "== 留言處理 =="
t "操作人員可更新自己品牌留言狀態" $C c@x.com ok "update comments set status='處理中' where id='c2000000-0000-0000-0000-000000000002'"
t "操作人員改不到別品牌留言(0列)" $C c@x.com 0 "with u as (update comments set status='已完成' where id='c1000000-0000-0000-0000-000000000001' returning 1) select count(*) from u"
t "不能修改留言原文" $A a@x.com err "update comments set body='竄改' where id='c1000000-0000-0000-0000-000000000001'"
t "不能新增留言(只有伺服器)" $A a@x.com err "insert into comments(workspace_id,brand_id,platform,author,body) values ('11111111-1111-1111-1111-111111111111','b1000000-0000-0000-0000-000000000001','instagram','x','偽造')"
t "可新增回覆(本人名義)" $C c@x.com ok "insert into replies(workspace_id,comment_id,body,by_member) values ('11111111-1111-1111-1111-111111111111','c2000000-0000-0000-0000-000000000002','好的','a0000000-0000-0000-0000-000000000003')"
t "不能冒用別人名義回覆" $C c@x.com err "insert into replies(workspace_id,comment_id,body,by_member) values ('11111111-1111-1111-1111-111111111111','c2000000-0000-0000-0000-000000000002','冒名','a0000000-0000-0000-0000-000000000001')"
t "不能自己標記為已送出" $C c@x.com err "insert into replies(workspace_id,comment_id,body,by_member,delivery) values ('11111111-1111-1111-1111-111111111111','c2000000-0000-0000-0000-000000000002','x','a0000000-0000-0000-0000-000000000003','sent')"
t "不能對沒權限的品牌留言回覆" $C c@x.com err "insert into replies(workspace_id,comment_id,body,by_member) values ('11111111-1111-1111-1111-111111111111','c1000000-0000-0000-0000-000000000001','越權','a0000000-0000-0000-0000-000000000003')"
echo "== 操作紀錄 =="
t "成員可新增紀錄" $C c@x.com ok "insert into audit_log(workspace_id,actor,action) values ('11111111-1111-1111-1111-111111111111','小琪','測試')"
t "紀錄不能修改" $A a@x.com err "update audit_log set action='改' "
t "紀錄不能刪除" $A a@x.com err "delete from audit_log"
t "操作人員看不到紀錄(0)" $C c@x.com 0 "select count(*) from audit_log"
t "管理員看得到紀錄(1)" $A a@x.com 1 "select count(*) from audit_log"
echo "== 建立公司與邀請 =="
t "新使用者可建立公司" $D d@x.com ok "select create_workspace('新公司','小D')"
t "未登入不能建立公司" '' '' err "select create_workspace('x','y')"
$DB -c "insert into auth.users values ('00000000-0000-0000-0000-0000000000ee','new@x.com'); insert into members(workspace_id,email,name,role) values ('11111111-1111-1111-1111-111111111111','new@x.com','新人','操作人員');" >/dev/null
t "被邀請者登入後可認領(1)" 00000000-0000-0000-0000-0000000000ee new@x.com 1 "select claim_invites()"
t "認領後看得到公司甲" 00000000-0000-0000-0000-0000000000ee new@x.com 1 "select count(*) from workspaces where id='11111111-1111-1111-1111-111111111111'"
t "匿名使用者什麼都看不到" '' '' err "set role anon; select * from comments"

echo "== v2：使用者個人資料 profiles =="
q "註冊時自動建立 profile(5)" 5 "select count(*) from profiles"
t "只看得到自己的 profile(1)" $A a@x.com 1 "select count(*) from profiles"
t "可改自己的暱稱" $A a@x.com 1 "with u as (update profiles set display_name='阿哲' where id='$A' returning 1) select count(*) from u"
t "改不到別人的 profile(0)" $A a@x.com 0 "with u as (update profiles set display_name='駭' where id='$B' returning 1) select count(*) from u"
t "不能改 profile 的 id 欄位" $A a@x.com err "update profiles set id='$B' where id='$A'"
t "不能自行新增 profile" $A a@x.com err "insert into profiles(id) values (gen_random_uuid())"
echo "== v2：貼文與留言同步 =="
$DB >/dev/null <<SQL
insert into social_accounts(id,workspace_id,brand_id,platform,handle,external_id,provider_user_id,status)
values ('5a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','b1000000-0000-0000-0000-000000000001','instagram','@warm','ig_123','fbuser_9','已連接');
SQL
ITEMS='[{"post_external_id":"m1","post_caption":"新品上市","post_permalink":"https://instagram.com/p/m1","external_id":"cm1","author":"小明","body":"好可愛","posted_at":"2026-10-01T10:00:00Z"},{"post_external_id":"m1","post_caption":"新品上市","external_id":"cm2","author":"小華","body":"多少錢","posted_at":"2026-10-01T11:00:00Z"},{"post_external_id":"m1","external_id":"cm2","author":"小華","body":"多少錢"}]'
sv "伺服器寫入留言：重複的自動略過(2)" 2 "select srv_ingest_comments('5a000000-0000-0000-0000-000000000001','$ITEMS'::jsonb)"
sv "同一批再寫一次不會重複(0)" 0 "select srv_ingest_comments('5a000000-0000-0000-0000-000000000001','$ITEMS'::jsonb)"
t "前端不能呼叫伺服器寫入函式" $A a@x.com err "select srv_ingest_comments('5a000000-0000-0000-0000-000000000001','[]'::jsonb)"
t "前端不能自己新增貼文" $A a@x.com err "insert into posts(workspace_id,brand_id,social_account_id,platform,external_id) values ('11111111-1111-1111-1111-111111111111','b1000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000001','instagram','x')"
t "主管看得到暖屋貼文(1)" $B b@x.com 1 "select count(*) from posts"
t "操作人員看不到沒被指派品牌的貼文(0)" $C c@x.com 0 "select count(*) from posts"
t "外人看不到公司甲貼文(0)" $D d@x.com 0 "select count(*) from posts"
t "不能把留言改到別篇貼文" $A a@x.com err "update comments set post_id=null where external_id='cm1'"
echo "== v2：token 安全 =="
out=$($DB -c "insert into social_account_secrets(account_id,encrypted_access_token) values ('5a000000-0000-0000-0000-000000000001','EAAGplaintext')" 2>&1)
if echo "$out" | grep -q check; then pass=$((pass+1)); echo "  通過  明文 token 存不進去（必須是 v1: 加密格式）"; else fail=$((fail+1)); echo "  失敗  明文 token 竟然存進去了"; fi
$DB -c "insert into social_account_secrets(account_id,encrypted_access_token) values ('5a000000-0000-0000-0000-000000000001','v1:aaa:bbb:ccc')" >/dev/null
t "管理員也讀不到加密 token" $A a@x.com err "select encrypted_access_token from social_account_secrets"
echo "== v2：配額與同步排程 =="
sv "扣 YouTube 配額 50(成功)" t "select srv_try_consume_quota('youtube',50,100,'America/Los_Angeles')"
sv "再扣 50 剛好用完(成功)" t "select srv_try_consume_quota('youtube',50,100,'America/Los_Angeles')"
sv "超過每日上限就拒絕" f "select srv_try_consume_quota('youtube',1,100,'America/Los_Angeles')"
t "前端不能動配額" $A a@x.com err "select srv_try_consume_quota('youtube',-999,100)"
sv "領取該同步的帳號(1)" 1 "select count(*) from srv_claim_sync_batch(10)"
sv "租約期間不會被重複領取(0)" 0 "select count(*) from srv_claim_sync_batch(10)"
sv "回報失敗" ok "select srv_finish_sync('5a000000-0000-0000-0000-000000000001',false,'timeout')"
q "第 1 次失敗 → 同步失敗、15 分鐘後重試" "同步失敗|1|true" "select status||'|'||fail_count||'|'||(next_sync_at between now()+interval '14 min' and now()+interval '16 min') from social_accounts where id='5a000000-0000-0000-0000-000000000001'"
sv "回報 token 過期" ok "select srv_finish_sync('5a000000-0000-0000-0000-000000000001',false,'190',true)"
q "token 過期 → 授權已過期，不再被領取" "授權已過期|0" "select status||'|'||(select count(*) from social_accounts where status in ('已連接','同步失敗','同步中') and next_sync_at<=now()) from social_accounts where id='5a000000-0000-0000-0000-000000000001'"
sv "回報成功 → 已連接、15 分鐘後再同步" ok "select srv_finish_sync('5a000000-0000-0000-0000-000000000001',true,null,false,'{\"since\":\"2026-10-01\"}')"
q "成功後 fail_count 歸零" "已連接|0" "select status||'|'||fail_count from social_accounts where id='5a000000-0000-0000-0000-000000000001'"
echo "== v2：Meta 資料刪除回呼 =="
sv "依 Meta 使用者刪除資料，回傳確認碼" ok "select srv_delete_by_provider_user(array['instagram','facebook'],'fbuser_9')"
q "社群帳號、token、貼文、該貼文留言都被刪除" "0|0|0|0" "select (select count(*) from social_accounts where provider_user_id='fbuser_9')||'|'||(select count(*) from social_account_secrets)||'|'||(select count(*) from posts)||'|'||(select count(*) from comments where external_id in ('cm1','cm2'))"
q "有刪除紀錄可查(1)" 1 "select count(*) from data_deletion_requests where provider_user_id='fbuser_9'"
t "前端讀不到刪除紀錄表" $A a@x.com err "select * from data_deletion_requests"
echo "== v2：一鍵刪除帳號 =="
t "前端不能直接呼叫刪除函式" $C c@x.com err "select srv_delete_user_data('$C')"
sv "唯一管理員(還有其他成員)被擋下" err "select srv_delete_user_data('$A')"
sv "計畫：外人的 2 間公司都會整間刪除" "2" "select count(*) from srv_deletion_plan('$D') where action='delete_workspace'"
sv "操作人員刪帳號 → 匿名化" ok "select srv_delete_user_data('$C')"
q "成員資料已匿名、回覆紀錄保留" "true|true|1" "select (name like '已刪除成員-%')||'|'||(user_id is null and email like '%@deleted.invalid')||'|'||(select count(*) from replies where by_member=m.id) from members m where id='a0000000-0000-0000-0000-000000000003'"
q "操作紀錄中的名字也匿名(0)" 0 "select count(*) from audit_log where actor='小琪'"
q "profile 已刪除(0)" 0 "select count(*) from profiles where id='$C'"
sv "外人刪帳號 → 自己的公司全部連動刪除" '{"deleted_workspaces": 2, "anonymized_memberships": 0}' "select srv_delete_user_data('$D')"
q "公司乙的留言、品牌、成員都不見了" "0|0|0" "select (select count(*) from comments where workspace_id='22222222-2222-2222-2222-222222222222')||'|'||(select count(*) from brands where workspace_id='22222222-2222-2222-2222-222222222222')||'|'||(select count(*) from members where user_id='$D')"
q "公司甲資料不受影響(2 則留言)" 2 "select count(*) from comments where workspace_id='11111111-1111-1111-1111-111111111111'"
$DB -c "delete from auth.users where id='$D'" >/dev/null
q "刪除登入帳號後無殘留" 0 "select count(*) from profiles where id='$D'"
echo; echo "通過 $pass 項，失敗 $fail 項"; [ $fail -eq 0 ]
