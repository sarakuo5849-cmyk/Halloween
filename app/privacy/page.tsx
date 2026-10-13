import { PRIVACY_VERSION } from '@/lib/privacy';

/**
 * ⚠ 草稿：正式上線前，請依實際情況修改（保存期限、聯絡方式、是否使用 AI 等），
 *   最好請老師、家長或法律專業人士看過。Meta 與 Google 審核都會檢查這一頁。
 */
export default function Privacy() {
  const contact = process.env.CONTACT_EMAIL || '（尚未設定聯絡信箱）';
  return (
    <div className="card" style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1>隱私權政策</h1>
      <p className="muted">版本 {PRIVACY_VERSION}（草稿，尚未正式生效）</p>

      <h2>1. 我們蒐集哪些資料</h2>
      <ul>
        <li>帳號資料：你的 email、你填寫的名字與暱稱。</li>
        <li>社群授權：你連接 Instagram／YouTube 時，平台發給我們的授權 token（加密保存，任何人無法在網頁上讀取）。</li>
        <li>社群內容：你所管理帳號的貼文與留言（含留言者的公開名稱與留言內容），以及你們團隊的回覆紀錄。</li>
        <li>操作紀錄：誰在什麼時間做了什麼操作，用於團隊管理與安全稽核。</li>
      </ul>

      <h2>2. 使用目的</h2>
      <p>僅用於讓你和你的團隊集中查看、分類與回覆社群留言。不販售、不出租資料，不用於廣告。</p>

      <h2>3. 資料保存與安全</h2>
      <ul>
        <li>資料存放於 Supabase（PostgreSQL），網站部署於 Vercel。</li>
        <li>資料庫啟用列級權限控管：不同公司之間互相看不到資料；成員只能看到被授權的品牌。</li>
        <li>保存期限：（待決定，例如留言保存 180 天後自動刪除）。</li>
      </ul>

      <h2>4. 你的權利</h2>
      <ul>
        <li>你可以隨時在「帳號設定」查看或修改個人資料。</li>
        <li>你可以在「帳號設定 → 刪除帳號」刪除帳號與相關資料。</li>
        <li>管理員可以在「社群帳號」頁解除連接，相關貼文與留言會一併刪除。</li>
        <li>若你從 Facebook 設定中移除本工具並要求刪除資料，我們會自動刪除相關資料並提供確認碼。</li>
      </ul>

      <h2>5. 聯絡我們</h2>
      <p>{contact}</p>
    </div>
  );
}
