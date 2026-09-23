import { redirect } from 'next/navigation';

/** `/admin` is not a screen — the Warden board is. */
export default function AdminIndex() {
  redirect('/admin/warden');
}
