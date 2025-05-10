import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
	const testFn = (data: { name: string }) => {
		console.log(data.name);
	}

	const body = await request.json();
	testFn(body);

	return NextResponse.json({ message: 'Hello, world!' });
}