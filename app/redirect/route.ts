import { NextResponse } from 'next/server';

export async function GET() {
  // Redirect to a specific URL
  return NextResponse.redirect('https://example.com');
}

export async function POST() {
  // Redirect to a specific URL with a 307 status code (Temporary Redirect)
  return NextResponse.redirect('https://example.com', { status: 307 });
}
