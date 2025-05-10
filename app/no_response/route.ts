// app/api/clear/route.ts

export async function POST() {
  return new Response(null, { status: 204 });
}
