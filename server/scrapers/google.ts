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

interface NearbySearchResponse {
  results: PlaceResult[];
  next_page_token?: string;
  status: string;
  error_message?: string;
}

interface LocationPoint {
  lat: number;
  lng: number;
  name: string;
}

// More granular Berlin districts
const BERLIN_DISTRICTS: LocationPoint[] = [
  { name: "Mitte", lat: 52.5200, lng: 13.4050 },
  { name: "Friedrichshain", lat: 52.5158, lng: 13.4540 },
  { name: "Kreuzberg", lat: 52.4983, lng: 13.4069 },
  { name: "Prenzlauer Berg", lat: 52.5380, lng: 13.4280 },
  { name: "Pankow", lat: 52.5667, lng: 13.4000 },
  { name: "Charlottenburg", lat: 52.5167, lng: 13.2833 },
  { name: "Wilmersdorf", lat: 52.4833, lng: 13.3167 },
  { name: "Spandau", lat: 52.5333, lng: 13.2000 },
  { name: "Steglitz", lat: 52.4500, lng: 13.3167 },
  { name: "Zehlendorf", lat: 52.4333, lng: 13.2667 },
  { name: "Neukölln", lat: 52.4667, lng: 13.4333 },
  { name: "Schöneberg", lat: 52.4833, lng: 13.3500 },
  { name: "Tempelhof", lat: 52.4667, lng: 13.3833 },
  { name: "Treptow", lat: 52.4667, lng: 13.5667 },
  { name: "Köpenick", lat: 52.4333, lng: 13.5833 },
  { name: "Marzahn", lat: 52.5333, lng: 13.5500 },
  { name: "Hellersdorf", lat: 52.5333, lng: 13.6333 },
  { name: "Lichtenberg", lat: 52.5167, lng: 13.4833 },
  { name: "Reinickendorf", lat: 52.6000, lng: 13.3167 },
  { name: "Weißensee", lat: 52.5500, lng: 13.4667 },
];

const HAMBURG_DISTRICTS: LocationPoint[] = [
  { name: "Mitte", lat: 53.5511, lng: 9.9937 },
  { name: "Altona", lat: 53.5500, lng: 9.9333 },
  { name: "Eimsbüttel", lat: 53.5744, lng: 9.9581 },
  { name: "Nord", lat: 53.6167, lng: 10.0167 },
  { name: "Wandsbek", lat: 53.5833, lng: 10.0833 },
  { name: "Bergedorf", lat: 53.4833, lng: 10.2167 },
  { name: "Harburg", lat: 53.4500, lng: 9.9833 },
];

const MUNICH_DISTRICTS: LocationPoint[] = [
  { name: "Altstadt", lat: 48.1374, lng: 11.5755 },
  { name: "Ludwigsvorstadt", lat: 48.1333, lng: 11.5667 },
  { name: "Maxvorstadt", lat: 48.1500, lng: 11.5833 },
  { name: "Schwabing", lat: 48.1667, lng: 11.6000 },
  { name: "Au", lat: 48.1167, lng: 11.5833 },
  { name: "Sendling", lat: 48.1167, lng: 11.5333 },
  { name: "Neuhausen", lat: 48.1500, lng: 11.5333 },
  { name: "Pasing", lat: 48.1500, lng: 11.4667 },
  { name: "Obermenzing", lat: 48.1833, lng: 11.5167 },
];

const CITY_DISTRICTS: Record<string, LocationPoint[]> = {
  berlin: BERLIN_DISTRICTS,
  hamburg: HAMBURG_DISTRICTS,
  münchen: MUNICH_DISTRICTS,
};

async function fetchPlaceDetails(placeId: string): Promise<{ phone?: string; website?: string }> {
  try {
    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website&key=${GOOGLE_API_KEY}`;
    const detailResp = await fetch(detailUrl);
    const detailData = await detailResp.json();
    if (detailData.result) {
      return {
        phone: detailData.result.formatted_phone_number,
        website: detailData.result.website,
      };
    }
  } catch {
    // silently ignore
  }
  return {};
}

async function nearbySearch(
  location: LocationPoint,
  radius: number = 10000,
  keyword: string
): Promise<PlaceResult[]> {
  const results: PlaceResult[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;
  const maxPages = 3;

  do {
    let url: string;
    
    if (pageToken) {
      url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${pageToken}&key=${GOOGLE_API_KEY}`;
    } else {
      url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${location.lat},${location.lng}&radius=${radius}&keyword=${encodeURIComponent(keyword)}&key=${GOOGLE_API_KEY}`;
    }

    const resp = await fetch(url);
    const data: NearbySearchResponse = await resp.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      if (data.status !== "OVER_QUERY_LIMIT") {
        console.error("Google Nearby Search error:", data.status, data.error_message || "");
      }
      break;
    }

    results.push(...data.results);
    pageToken = data.next_page_token;
    pageCount++;

    if (pageToken && pageCount < maxPages) {
      await new Promise((r) => setTimeout(r, 3500));
    }
  } while (pageToken && pageCount < maxPages);

  return results;
}

async function textSearch(
  query: string,
  location?: LocationPoint,
  radius: number = 10000
): Promise<PlaceResult[]> {
  const results: PlaceResult[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;
  const maxPages = 3;

  do {
    let url: string;
    
    if (pageToken) {
      url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${pageToken}&key=${GOOGLE_API_KEY}`;
    } else if (location) {
      url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${location.lat},${location.lng}&radius=${radius}&key=${GOOGLE_API_KEY}`;
    } else {
      url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}`;
    }

    const resp = await fetch(url);
    const data: TextSearchResponse = await resp.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      if (data.status !== "OVER_QUERY_LIMIT") {
        console.error("Google Text Search error:", data.status, data.error_message || "");
      }
      break;
    }

    results.push(...data.results);
    pageToken = data.next_page_token;
    pageCount++;

    if (pageToken && pageCount < maxPages) {
      await new Promise((r) => setTimeout(r, 3500));
    }
  } while (pageToken && pageCount < maxPages);

  return results;
}

export async function scrapeGoogle(
  query: string,
  location: string
): Promise<ScrapedBusiness[]> {
  if (!GOOGLE_API_KEY) {
    return [{
      name: "⚠️ Google API Key fehlt",
      address: "Bitte GOOGLE_PLACES_API_KEY setzen",
      source: "google",
      category: "error",
    }];
  }

  const normalizedLocation = location.toLowerCase().replace(/[\s-]/g, '');
  const districts = CITY_DISTRICTS[normalizedLocation];
  
  const allResults: ScrapedBusiness[] = [];
  const seenPlaceIds = new Set<string>();

  // Generate multiple search terms based on query
  const queryLower = query.toLowerCase();
  const searchTerms: string[] = [];
  
  if (queryLower.includes('hausverwaltung') || queryLower.includes('verwaltung')) {
    searchTerms.push(
      'Hausverwaltung',
      'Immobilienverwaltung', 
      'Wohnungsverwaltung',
      'Liegenschaftsverwaltung',
      'Siedlergemeinschaft',
      'Eigentümergemeinschaft',
      'WEG Verwaltung'
    );
  } else {
    searchTerms.push(query);
  }

  console.log(`Google: Search terms: ${searchTerms.join(', ')}`);

  // Build comprehensive search strategies
  const strategies: Array<{ type: 'text' | 'nearby'; term: string; location?: LocationPoint }> = [];

  // 1. General text search
  strategies.push({ type: 'text', term: `${query} ${location}` });

  // 2. District-based text searches (top 3 terms per district)
  if (districts) {
    for (const district of districts) {
      for (const term of searchTerms.slice(0, 3)) {
        strategies.push({ type: 'text', term, location: district });
      }
    }
  }

  // 3. Nearby searches with key terms (select districts)
  if (districts) {
    const selectedDistricts = districts.filter((_, i) => i % 3 === 0); // Every 3rd district
    for (const district of selectedDistricts) {
      strategies.push({ type: 'nearby', term: 'Hausverwaltung', location: district });
      strategies.push({ type: 'nearby', term: 'Immobilien', location: district });
    }
  }

  console.log(`Google: ${strategies.length} search strategies`);

  // Process in batches
  const concurrency = 3;
  
  for (let i = 0; i < strategies.length; i += concurrency) {
    const batch = strategies.slice(i, i + concurrency);
    
    const batchPromises = batch.map(async (strategy, idx) => {
      const strategyNum = i + idx + 1;
      
      try {
        let places: PlaceResult[] = [];
        
        if (strategy.type === 'text') {
          places = await textSearch(strategy.term, strategy.location, 10000);
        } else {
          places = await nearbySearch(strategy.location!, 10000, strategy.term);
        }

        console.log(`Google: Strategy ${strategyNum}/${strategies.length}: ${places.length} places (${strategy.type}: ${strategy.term.substring(0, 30)})`);
        
        const businesses: ScrapedBusiness[] = [];
        
        for (const place of places) {
          if (seenPlaceIds.has(place.place_id)) continue;
          seenPlaceIds.add(place.place_id);

          const details = await fetchPlaceDetails(place.place_id);
          const addrParts = place.formatted_address?.split(",") || [];
          const city = addrParts[addrParts.length - 2]?.trim();

          businesses.push({
            name: place.name,
            address: place.formatted_address,
            city,
            phone: details.phone,
            website: details.website,
            source: "google",
            sourceId: place.place_id,
            lat: place.geometry?.location.lat.toString(),
            lng: place.geometry?.location.lng.toString(),
            category: place.types?.[0]?.replace(/_/g, " "),
            rawData: place,
          });
        }
        
        return businesses;
      } catch (err) {
        console.warn(`Google: Strategy ${strategyNum} failed`);
        return [];
      }
    });

    const batchResults = await Promise.all(batchPromises);
    for (const businesses of batchResults) {
      allResults.push(...businesses);
    }

    if (i + concurrency < strategies.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`Google: ${allResults.length} unique results`);
  return allResults;
}
