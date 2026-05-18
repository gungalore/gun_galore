import { NextResponse } from 'next/server';

export function GET() {
  const res = NextResponse.redirect(new URL('/admin/login', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'));
  res.cookies.delete('admin_token');
  return res;
}
