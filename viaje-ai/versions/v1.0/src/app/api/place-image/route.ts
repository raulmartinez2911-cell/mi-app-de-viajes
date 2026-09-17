import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query) return NextResponse.json({ error: "Falta el lugar" }, { status: 400 });

  async function findImage(search: string) {
    const params = new URLSearchParams({ action: "query", generator: "search", gsrsearch: search, gsrnamespace: "6", gsrlimit: "5", prop: "imageinfo", iiprop: "url", iiurlwidth: "1200", format: "json", origin: "*" });
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { next: { revalidate: 86400 } });
    const result = await response.json();
    const pages = Object.values(result.query?.pages || {}) as { imageinfo?: { thumburl?: string; url?: string }[] }[];
    return pages.find((page) => page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url)?.imageinfo?.[0];
  }

  try {
    const image = await findImage(query) || await findImage(query.replace(/,?\s*famous landmark/i, ""));
    return NextResponse.json({ url: image?.thumburl || image?.url || null });
  } catch {
    return NextResponse.json({ url: null });
  }
}