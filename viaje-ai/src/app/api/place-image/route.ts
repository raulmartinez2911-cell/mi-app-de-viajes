import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query) return NextResponse.json({ error: "Falta el lugar" }, { status: 400 });

  async function findImage(search: string) {
    const params = new URLSearchParams({ action: "query", generator: "search", gsrsearch: search, gsrnamespace: "6", gsrlimit: "5", prop: "imageinfo", iiprop: "url", iiurlwidth: "1200", format: "json", origin: "*" });
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { next: { revalidate: 86400 } });
    const result = await response.json();
    const pages = Object.values(result.query?.pages || {}) as { title?: string; imageinfo?: { thumburl?: string; url?: string }[] }[];
    const landmarkTitle = /monument|landmark|street|avenue|square|plaza|tower|palace|castle|bridge|cathedral|basilica|museum|temple|acropolis|torre|castelo|praça|rua|puente|palacio/i;
    return pages.find((page) => landmarkTitle.test(page.title || "") && (page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url)) || pages.find((page) => page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url);
  }

  try {
    const baseQuery = query.replace(/,?\s*(most famous monument landmark or famous street|iconic building|famous monument|landmark)/i, "").trim();
    const searches = [
      `${baseQuery} iconic monument`,
      `${baseQuery} famous building`,
      `${baseQuery} cathedral landmark`,
      `${baseQuery} famous skyline monument`,
      `${baseQuery} landmark`,
      `${baseQuery} famous street`,
      baseQuery,
    ];
    let selected: { imageinfo?: { thumburl?: string; url?: string }[] } | undefined;
    for (const search of searches) {
      const candidate = await findImage(search);
      if (candidate) { selected = candidate; break; }
    }
    const image = selected?.imageinfo?.[0];
    return NextResponse.json({ url: image?.thumburl || image?.url || null });
  } catch {
    return NextResponse.json({ url: null });
  }
}