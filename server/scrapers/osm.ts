import type { ScrapedBusiness } from "./types";

interface OverpassElement {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

// Bounding boxes for major German cities (approximate)
const CITY_BOUNDING_BOXES: Record<string, BoundingBox> = {
  berlin: { minLon: 13.0883, minLat: 52.3381, maxLon: 13.7612, maxLat: 52.6755 },
  hamburg: { minLon: 9.7303, minLat: 53.3999, maxLon: 10.3258, maxLat: 53.7482 },
  münchen: { minLon: 11.3606, minLat: 48.0616, maxLon: 11.7229, maxLat: 48.2482 },
  köln: { minLon: 6.7725, minLat: 50.8303, maxLon: 7.1620, maxLat: 51.0849 },
  frankfurt: { minLon: 8.4728, minLat: 50.0155, maxLon: 8.8004, maxLat: 50.2265 },
  stuttgart: { minLon: 9.0386, minLat: 48.6919, maxLon: 9.3174, maxLat: 48.8661 },
  düsseldorf: { minLon: 6.6885, minLat: 51.1243, maxLon: 6.9390, maxLat: 51.3525 },
  leipzig: { minLon: 12.2369, minLat: 51.2956, maxLon: 12.5422, maxLat: 51.4485 },
  dortmund: { minLon: 7.3048, minLat: 51.4155, maxLon: 7.6377, maxLat: 51.5995 },
  essen: { minLon: 6.8948, minLat: 51.3464, maxLon: 7.1620, maxLat: 51.5499 },
  bremen: { minLon: 8.4810, minLat: 53.0104, maxLon: 8.9905, maxLat: 53.5980 },
  dresden: { minLon: 13.5792, minLat: 50.9708, maxLon: 13.9787, maxLat: 51.1787 },
  hannover: { minLon: 9.6040, minLat: 52.3030, maxLon: 9.9257, maxLat: 52.4545 },
  nürnberg: { minLon: 10.9651, minLat: 49.3276, maxLon: 11.1650, maxLat: 49.5300 },
  duisburg: { minLon: 6.5958, minLat: 51.3543, maxLon: 6.8103, maxLat: 51.5621 },
  bochum: { minLon: 7.1017, minLat: 51.4261, maxLon: 7.3487, maxLat: 51.5306 },
  wuppertal: { minLon: 7.0323, minLat: 51.1969, maxLon: 7.3144, maxLat: 51.3129 },
  bielefeld: { minLon: 8.4557, minLat: 51.9447, maxLon: 8.6633, maxLat: 52.0902 },
  bonn: { minLon: 7.0225, minLat: 50.6321, maxLon: 7.2107, maxLat: 50.7745 },
  mannheim: { minLon: 8.4148, minLat: 49.4096, maxLon: 8.5893, maxLat: 49.5906 },
};

// Mapping: German branch keywords → OSM tag filter
const BRANCH_OSM_FILTERS: Array<{ keywords: string[]; tagFilter: string }> = [
  {
    keywords: ["hausverwaltung", "immobilien", "wohnungsverwaltung", "property", "verwaltung"],
    tagFilter: `["office"~"property_management|estate_agent|real_estate",i]`,
  },
  { keywords: ["arzt", "allgemeinmedizin", "hausarzt"], tagFilter: `["amenity"="doctors"]` },
  { keywords: ["zahnarzt"], tagFilter: `["amenity"="dentist"]` },
  { keywords: ["apotheke"], tagFilter: `["amenity"="pharmacy"]` },
  { keywords: ["restaurant", "gaststätte", "bistro", "imbiss"], tagFilter: `["amenity"="restaurant"]` },
  { keywords: ["bäckerei", "bäcker"], tagFilter: `["shop"="bakery"]` },
  { keywords: ["friseur", "frisör"], tagFilter: `["shop"="hairdresser"]` },
  { keywords: ["rechtsanwalt", "anwalt"], tagFilter: `["amenity"="lawyer"]` },
  { keywords: ["steuerberater"], tagFilter: `["office"="tax_advisor"]` },
  { keywords: ["versicherung"], tagFilter: `["office"="insurance"]` },
  { keywords: ["bank", "sparkasse", "volksbank", "commerzbank"], tagFilter: `["amenity"="bank"]` },
  { keywords: ["hotel"], tagFilter: `["tourism"="hotel"]` },
  { keywords: ["supermarkt", "lebensmittel"], tagFilter: `["shop"="supermarket"]` },
  { keywords: ["schule", "gymnasium"], tagFilter: `["amenity"="school"]` },
  { keywords: ["kita", "kindergarten"], tagFilter: `["amenity"="kindergarten"]` },
  { keywords: ["tischler", "tischlerei", "schreiner"], tagFilter: `["craft"="carpenter"]` },
  { keywords: ["elektriker", "elektro"], tagFilter: `["craft"="electrician"]` },
  { keywords: ["autowerkstatt", "kfz"], tagFilter: `["shop"="car_repair"]` },
];

function inferOsmTagFilter(query: string): string | null {
  const lower = query.toLowerCase();
  for (const entry of BRANCH_OSM_FILTERS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.tagFilter;
    }
  }
  return null;
}

// Multiple Overpass endpoints for fallback (prioritize faster ones)
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter", // Often rate limited
];

async function runOverpassQuerySingle(endpoint: string, oql: string, timeoutMs: number): Promise<OverpassResponse> {
  const body = new URLSearchParams({ data: oql });
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      body: body.toString(),
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "BusinessScraper/1.0"
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (resp.status === 429) {
      throw new Error("Rate limited");
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }

    return resp.json() as Promise<OverpassResponse>;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function runOverpassQuery(oql: string, timeoutMs: number = 60000): Promise<OverpassResponse> {
  // Try all endpoints in parallel, return the first success
  const promises = OVERPASS_ENDPOINTS.map(async (endpoint) => {
    try {
      const result = await runOverpassQuerySingle(endpoint, oql, timeoutMs);
      return { endpoint, result, error: null };
    } catch (err) {
      return { endpoint, result: null, error: err };
    }
  });

  const results = await Promise.all(promises);
  
  // Find first successful result
  const success = results.find(r => r.result !== null);
  if (success) {
    if (results.some(r => r.error && r.endpoint !== success.endpoint)) {
      console.log(`OSM: Used ${success.endpoint} (other endpoints failed)`);
    }
    return success.result!;
  }

  // All failed
  const errors = results.map(r => `${r.endpoint}: ${r.error instanceof Error ? r.error.message : r.error}`).join('; ');
  throw new Error(`All Overpass endpoints failed: ${errors}`);
}

/**
 * Split a bounding box into a grid of smaller tiles
 */
function splitBoundingBox(
  bbox: BoundingBox, 
  numTilesX: number = 4, 
  numTilesY: number = 4
): BoundingBox[] {
  const tiles: BoundingBox[] = [];
  const lonStep = (bbox.maxLon - bbox.minLon) / numTilesX;
  const latStep = (bbox.maxLat - bbox.minLat) / numTilesY;

  for (let x = 0; x < numTilesX; x++) {
    for (let y = 0; y < numTilesY; y++) {
      tiles.push({
        minLon: bbox.minLon + x * lonStep,
        maxLon: bbox.minLon + (x + 1) * lonStep,
        minLat: bbox.minLat + y * latStep,
        maxLat: bbox.minLat + (y + 1) * latStep,
      });
    }
  }

  return tiles;
}

/**
 * Build Overpass query for a specific bounding box
 */
function buildBBoxQuery(
  bbox: BoundingBox, 
  tagFilter: string | null, 
  escapedQuery: string
): string {
  const bboxStr = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  
  if (tagFilter) {
    return `
[out:json][timeout:15];
(
  node${tagFilter}(${bboxStr});
  way${tagFilter}(${bboxStr});
);
out center tags 100;
`;
  } else {
    return `
[out:json][timeout:15];
(
  node["name"~"${escapedQuery}",i]["office"](${bboxStr});
  node["name"~"${escapedQuery}",i]["amenity"](${bboxStr});
  node["name"~"${escapedQuery}",i]["shop"](${bboxStr});
  way["name"~"${escapedQuery}",i]["office"](${bboxStr});
  way["name"~"${escapedQuery}",i]["amenity"](${bboxStr});
);
out center tags 100;
`;
  }
}

/**
 * Execute queries for multiple tiles with concurrency control
 */
async function queryTilesWithConcurrency(
  tiles: BoundingBox[],
  tagFilter: string | null,
  escapedQuery: string,
  concurrency: number = 1
): Promise<OverpassElement[]> {
  const allElements: OverpassElement[] = [];
  const seenIds = new Set<number>();
  
  console.log(`OSM: Querying ${tiles.length} tiles sequentially with delays...`);
  
  // Process tiles sequentially with longer delays to avoid rate limiting
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const tileNum = i + 1;
    
    // Longer delay between tiles (3 seconds) to respect rate limits
    if (i > 0) {
      console.log(`OSM: Waiting 3s before next tile...`);
      await new Promise(r => setTimeout(r, 3000));
    }
    
    console.log(`OSM: Processing tile ${tileNum}/${tiles.length}...`);
    
    const query = buildBBoxQuery(tile, tagFilter, escapedQuery);
    
    try {
      const data = await runOverpassQuery(query, 25000);
      console.log(`OSM: Tile ${tileNum}/${tiles.length} returned ${data.elements?.length || 0} results`);
      
      // Merge results, avoiding duplicates
      for (const el of data.elements || []) {
        if (!seenIds.has(el.id)) {
          seenIds.add(el.id);
          allElements.push(el);
        }
      }
    } catch (err) {
      console.warn(`OSM: Tile ${tileNum}/${tiles.length} failed:`, err instanceof Error ? err.message : err);
      // Continue with next tile even if this one failed
    }
    
    // Stop early if we have enough results
    if (allElements.length >= 200) {
      console.log(`OSM: Reached 200 results, stopping early`);
      break;
    }
  }
  
  console.log(`OSM: Total unique results from tiles: ${allElements.length}`);
  return allElements;
}

export async function scrapeOSM(
  query: string,
  location: string
): Promise<ScrapedBusiness[]> {
  console.log(`OSM: Searching for "${query}" in "${location}"...`);
  
  const tagFilter = inferOsmTagFilter(query);
  const escapedQuery = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  
  const results: ScrapedBusiness[] = [];
  const seen = new Set<number>();
  
  // Try to find bounding box for the location
  const locationKey = location.toLowerCase().replace(/[\s-]/g, '');
  const bbox = CITY_BOUNDING_BOXES[locationKey];
  
  if (bbox) {
    console.log(`OSM: Found bounding box for ${location}, using tile-based search`);
    
    // Split into tiles (4x4 grid = 16 tiles for a city)
    const tiles = splitBoundingBox(bbox, 4, 4);
    console.log(`OSM: Split into ${tiles.length} tiles`);
    
    try {
      const elements = await queryTilesWithConcurrency(tiles, tagFilter, escapedQuery, 3);
      
      for (const el of elements) {
        if (!el.tags?.name) continue;
        if (seen.has(el.id)) continue;
        seen.add(el.id);

        const tags = el.tags;
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;

        const street = tags["addr:street"] || "";
        const houseNum = tags["addr:housenumber"] || "";
        const address = [street, houseNum].filter(Boolean).join(" ") || undefined;

        results.push({
          name: tags.name,
          address,
          city: tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || location,
          zip: tags["addr:postcode"],
          phone: tags["phone"] || tags["contact:phone"] || tags["telephone"],
          website: tags["website"] || tags["contact:website"] || tags["url"],
          email: tags["email"] || tags["contact:email"],
          source: "osm",
          sourceId: `${el.type}/${el.id}`,
          lat: lat?.toString(),
          lng: lon?.toString(),
          category: tags.office || tags.amenity || tags.shop || tags.craft || tags.tourism,
          rawData: tags,
        });
      }
      
      console.log(`OSM: Found ${results.length} results for "${query}" in "${location}"`);
      return results;
      
    } catch (err) {
      console.warn(`OSM: Tile-based search failed, trying fallback:`, err);
    }
  } else {
    console.log(`OSM: No bounding box for ${location}, trying fallback search`);
  }
  
  // Fallback: Global search without bounding box
  try {
    console.log(`OSM: Trying fallback global search...`);
    let fallbackOql: string;
    
    if (tagFilter) {
      fallbackOql = `
[out:json][timeout:20];
(
  node${tagFilter}["name"~"${escapedQuery}",i];
  way${tagFilter}["name"~"${escapedQuery}",i];
);
out center tags 50;
`;
    } else {
      fallbackOql = `
[out:json][timeout:20];
(
  node["name"~"${escapedQuery}",i]["office"];
  node["name"~"${escapedQuery}",i]["amenity"];
  way["name"~"${escapedQuery}",i]["office"];
);
out center tags 50;
`;
    }
    
    const data = await runOverpassQuery(fallbackOql, 25000);
    
    for (const el of data.elements) {
      if (!el.tags?.name) continue;
      if (seen.has(el.id)) continue;
      seen.add(el.id);

      const tags = el.tags;
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;

      const street = tags["addr:street"] || "";
      const houseNum = tags["addr:housenumber"] || "";
      const address = [street, houseNum].filter(Boolean).join(" ") || undefined;

      results.push({
        name: tags.name,
        address,
        city: tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || location,
        zip: tags["addr:postcode"],
        phone: tags["phone"] || tags["contact:phone"] || tags["telephone"],
        website: tags["website"] || tags["contact:website"] || tags["url"],
        email: tags["email"] || tags["contact:email"],
        source: "osm",
        sourceId: `${el.type}/${el.id}`,
        lat: lat?.toString(),
        lng: lon?.toString(),
        category: tags.office || tags.amenity || tags.shop || tags.craft || tags.tourism,
        rawData: tags,
      });
    }
    
    console.log(`OSM: Found ${results.length} results (fallback) for "${query}" in "${location}"`);
  } catch (fallbackErr) {
    console.warn("OSM fallback search failed:", fallbackErr);
  }
  
  return results;
}
