/** 顯示 Server Action 帶回來的訊息（?ok=... 或 ?error=...） */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function Flash({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string).slice(0, 200) : '');
  const ok = pick('ok');
  const error = pick('error');
  return (
    <>
      {ok && <div className="msg ok">{ok}</div>}
      {error && <div className="msg error">{error}</div>}
    </>
  );
}
