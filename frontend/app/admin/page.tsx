import { redirect } from 'next/navigation';

/**
 * /admin IS THE DESK.
 *
 * ⚠️ THIS FILE IS THE CUTOVER. Until it existed, `/admin` was the legacy
 * dashboard at app/admin/(protected)/page.tsx and the Desk was a link inside
 * its sidebar — a rebuild sitting beside the thing it was meant to replace,
 * which is how a rebuild quietly dies. That whole tree is now deleted and this
 * takes its route.
 *
 * A redirect rather than the board itself: the Desk's five surfaces each own a
 * path under /admin/desk, and having /admin ALSO render the pile would give
 * the same board two URLs and two entries in anyone's history.
 */
export default function AdminRoot() {
  redirect('/admin/desk');
}
