import { redirect } from 'next/navigation';
import { supabaseReady } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

// 首頁：依狀態分流 → 未設定環境變數 /status、未登入 /login、已登入 /app
export default async function Home() {
  if (!supabaseReady()) redirect('/status');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? '/app' : '/login');
}
