'use client';
import { useActionState } from 'react';
import { deleteMyAccount } from '@/app/actions/account';

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState(deleteMyAccount, null);
  return (
    <form action={action}>
      <label htmlFor="confirm">請輸入「刪除我的帳號」確認</label>
      <input id="confirm" name="confirm" type="text" autoComplete="off" required />
      {state?.error && (
        <div className="msg error" style={{ marginTop: 12 }}>
          {state.error}
        </div>
      )}
      <p />
      <button type="submit" className="danger" disabled={pending}>
        {pending ? '刪除中…' : '永久刪除我的帳號'}
      </button>
    </form>
  );
}
