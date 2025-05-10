import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Define the form data schema
const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  message: z.string().min(10, "Message must be at least 10 characters")
});

// Add a schema to validate form data responses, including the form ID
const formResponseSchema = formSchema.extend({
  id: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate the form data
    const validatedData = formSchema.parse(body);
    
    // Generate a unique ID for the submission and validate response data
    const id = Date.now().toString();
    const responseData = formResponseSchema.parse({ id, ...validatedData });
    
    // Here you would typically save the data to a database
    // For this example, we'll return the validated response data
    return NextResponse.json({
      success: true,
      data: responseData,
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Example of getting form data from query parameters
    const searchParams = request.nextUrl.searchParams;
    const formId = searchParams.get('formId');

    if (!formId) {
      return NextResponse.json(
        { success: false, error: "Form ID is required" },
        { status: 400 }
      );
    }

    // Mock data for example
    const mockData = {
      id: formId,
      name: "John Doe",
      email: "john@example.com",
      message: "This is a sample message"
    };
    // Validate the response data
    const validatedResponse = formResponseSchema.parse(mockData);

    return NextResponse.json({
      success: true,
      data: validatedResponse,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
