import { NextResponse } from "next/server";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");
    if (!url) {
      return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
    }

    // Fetch the file from the remote server
    const res = await fetch(url);
    if (!res.ok) {
      return NextResponse.json({ error: `Failed to fetch remote media: ${res.statusText}` }, { status: res.status });
    }

    // Forward the file as a download attachment
    const headers = new Headers();
    headers.set("Content-Type", res.headers.get("Content-Type") || "video/mp4");
    headers.set("Content-Disposition", `attachment; filename="video.mp4"`);

    return new Response(res.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
