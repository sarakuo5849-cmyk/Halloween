/**
 * 「以目前登入者身分」連 Supabase（anon key + 使用者 cookie）
 * 用這個查資料時，RLS 會生效：使用者只拿得到自己有權限的資料。
 * 能用這個做的事，就不要用 admin（service_role）做。
 */
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // 在 Server Component 裡無法寫 cookie，交給 middleware 更新登入狀態即可
        }
      },
    },
  });
}
