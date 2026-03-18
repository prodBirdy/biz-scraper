import type { ScrapedBusiness } from "./types";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

interface PlaceResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  geometry?: { location: { lat: number; lng: number } };
  formatted_phone_number?: string;
  website?: string;
  types?: string[];
  international_phone_number?: string;
}

interface TextSearchResponse {
  results: PlaceResult[];
  next_page_token?: string;
  status: string;
  error_message?: string;
}

export async function scrapeGoogle(
  query: string,
  location: string
): Promise<ScrapedBusiness[]> {
  if (!GOOGLE_API_KEY) {
    return [{
      name: "⚠️ Google API Key fehlt",
      address: "Bitte GOOGLE_PLACES_API_KEY als Umgebungsvariable setzen",
      source: "google",
      category: "error",
    }];
  }

  const results: ScrapedBusiness[] = [];
  let pageToken: string | undefined;

  // Google Text Search: query + location
  const searchQuery = encodeURIComponent(`${query} ${location}`);

  do {
    const url = pageToken
      ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${pageToken}&key=${GOOGLE_API_KEY}`
      : `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${searchQuery}&key=${GOOGLE_API_KEY}`;

    const resp = await fetch(url);
    const data: TextSearchResponse = await resp.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("Google Places error:", data.status, data.error_message);
      break;
    }

    for (const place of data.results) {
      // Optional: fetch Place Details for phone + website
      let phone: string | undefined;
      let website: string | undefined;

      try {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=formatted_phone_number,website,address_components&key=${GOOGLE_API_KEY}`;
        const detailResp = await fetch(detailUrl);
        const detailData = await detailResp.json();
        if (detailData.result) {
          phone = detailData.result.formatted_phone_number;
          website = detailData.result.website;
        }
      } catch {
        // silently ignore detail fetch errors
      }

      // Parse address components
      const addrParts = place.formatted_address?.split(",") || [];
      const city = addrParts[addrParts.length - 2]?.trim();

      results.push({
        name: place.name,
        address: place.formatted_address,
        city,
        phone,
        website,
        source: "google",
        sourceId: place.place_id,
        lat: place.geometry?.location.lat.toString(),
        lng: place.geometry?.location.lng.toString(),
        category: place.types?.[0]?.replace(/_/g, " "),
        rawData: place,
      });
    }

    pageToken = data.next_page_token;
    if (pageToken) {
      // Google requires a short delay before using next_page_token
      await new Promise((r) => setTimeout(r, 2000));
    }
  } while (pageToken && results.length < 60);

  return results;
}
