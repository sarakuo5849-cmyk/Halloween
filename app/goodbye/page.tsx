import Link from 'next/link';

export default function Goodbye() {
  return (
    <div className="narrow card">
      <h1>帳號已刪除</h1>
      <p>你的帳號與相關資料已從我們的資料庫刪除，並已嘗試撤銷社群平台的授權。</p>
      <p className="muted">
        若想再次確認，也可以到 Facebook／Google 帳號設定的「應用程式與網站」中移除本工具。資料庫備份會在備份保存期限到期後自動消失。
      </p>
      <Link href="/login">回到首頁</Link>
    </div>
  );
}
