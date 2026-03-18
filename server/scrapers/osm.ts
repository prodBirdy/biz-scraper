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

// Multiple Overpass endpoints for fallback (prioritize faster ones)
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
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
  
  const success = results.find(r => r.result !== null);
  if (success) {
    if (results.some(r => r.error && r.endpoint !== success.endpoint)) {
      console.log(`OSM: Used ${success.endpoint} (other endpoints failed)`);
    }
    return success.result!;
  }

  const errors = results.map(r => `${r.endpoint}: ${r.error instanceof Error ? r.error.message : r.error}`).join('; ');
  throw new Error(`All Overpass endpoints failed: ${errors}`);
}

/**
 * Split a bounding box into a grid of smaller tiles
 */
function splitBoundingBox(
  bbox: BoundingBox, 
  numTilesX: number = 6, 
  numTilesY: number = 6
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
 * Build Overpass query for name-based search
 */
function buildNameQuery(
  bbox: BoundingBox, 
  namePatterns: string[],
  limit: number = 200
): string {
  const bboxStr = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  const patterns = namePatterns.map(p => `"${p}"`).join(',');
  
  return `
[out:json][timeout:20];
(
  node["name"~"${patterns}",i]["office"](${bboxStr});
  way["name"~"${patterns}",i]["office"](${bboxStr});
  node["name"~"${patterns}",i]["shop"](${bboxStr});
  way["name"~"${patterns}",i]["shop"](${bboxStr});
);
out center tags ${limit};
`;
}

/**
 * Build Overpass query for tag-based search
 */
function buildTagQuery(
  bbox: BoundingBox,
  limit: number = 200
): string {
  const bboxStr = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  
  return `
[out:json][timeout:20];
(
  node["office"="property_management"](${bboxStr});
  way["office"="property_management"](${bboxStr});
  node["office"="estate_agent"](${bboxStr});
  way["office"="estate_agent"](${bboxStr});
  node["office"="real_estate"](${bboxStr});
  way["office"="real_estate"](${bboxStr});
  node["office"="property"](${bboxStr});
  way["office"="property"](${bboxStr});
);
out center tags ${limit};
`;
}

/**
 * Build Overpass query for generic office search with filtering
 */
function buildGenericOfficeQuery(
  bbox: BoundingBox,
  limit: number = 200
): string {
  const bboxStr = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  
  return `
[out:json][timeout:25];
(
  node["office"]["name"](${bboxStr});
  way["office"]["name"](${bboxStr});
);
out center tags ${limit};
`;
}

/**
 * Check if a business name indicates property management
 */
function isPropertyManagement(name: string): boolean {
  const keywords = [
    'hausverwaltung', 'verwaltung', 'immobilien', 'wohnungsverwaltung',
    'siedler', 'mieter', 'eigentümer', 'wohnungseigentümer', 'wohneigentum',
    'wohnungsbau', 'wohnungsgenossenschaft', 'wohnungsgesellschaft',
    'bauverein', 'baugenossenschaft', 'baugesellschaft',
    'grundstück', 'grundstücksverwaltung', 'grundstücksgesellschaft',
    'liegenschaft', 'liegenschaftsverwaltung',
    'property', 'real estate', 'estate', 'wohnen',
  ];
  
  const lowerName = name.toLowerCase();
  return keywords.some(kw => lowerName.includes(kw));
}

/**
 * Execute queries for multiple tiles with multiple strategies
 */
async function queryTilesMultiStrategy(
  tiles: BoundingBox[],
  query: string,
  concurrency: number = 3
): Promise<OverpassElement[]> {
  const allElements: OverpassElement[] = [];
  const seenIds = new Set<number>();
  
  // Determine search patterns based on query
  const queryLower = query.toLowerCase();
  let namePatterns: string[] = [];
  
  if (queryLower.includes('hausverwaltung') || queryLower.includes('verwaltung')) {
    namePatterns = ['Hausverwaltung', 'Immobilien', 'Wohnungsverwaltung', 'Verwaltung', 'Siedler', 'Mieter'];
  } else if (queryLower.includes('arzt') || queryLower.includes('doctor')) {
    namePatterns = ['Arzt', 'Praxis', 'Medizin'];
  } else if (queryLower.includes('rechtsanwalt') || queryLower.includes('anwalt')) {
    namePatterns = ['Rechtsanwalt', 'Anwalt', 'Kanzlei'];
  } else {
    namePatterns = [query];
  }
  
  console.log(`OSM: Searching for patterns: ${namePatterns.join(', ')}`);
  console.log(`OSM: Querying ${tiles.length} tiles with ${concurrency} strategies...`);
  
  // Process all tiles
  for (let i = 0; i < tiles.length; i += concurrency) {
    const batch = tiles.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(tiles.length / concurrency);
    
    // For each tile, run multiple query strategies in parallel
    const tilePromises = batch.map(async (tile, idx) => {
      const tileNum = i + idx + 1;
      
      // Run 3 different query strategies for this tile
      const strategies = [
        { name: 'tags', query: buildTagQuery(tile, 150) },
        { name: 'names', query: buildNameQuery(tile, namePatterns, 150) },
        { name: 'generic', query: buildGenericOfficeQuery(tile, 150) },
      ];
      
      const strategyResults = await Promise.all(
        strategies.map(async (strategy) => {
          try {
            const data = await runOverpassQuery(strategy.query, 20000);
            return { strategy: strategy.name, elements: data.elements || [] };
          } catch (err) {
            return { strategy: strategy.name, elements: [] };
          }
        })
      );
      
      const totalElements = strategyResults.reduce((sum, r) => sum + r.elements.length, 0);
      console.log(`OSM: Tile ${tileNum}/${tiles.length} - ${totalElements} results (tags:${strategyResults[0].elements.length}, names:${strategyResults[1].elements.length}, generic:${strategyResults[2].elements.length})`);
      
      // Combine all elements
      return strategyResults.flatMap(r => r.elements);
    });
    
    const batchResults = await Promise.all(tilePromises);
    
    // Merge results, avoiding duplicates and filtering
    for (const elements of batchResults) {
      for (const el of elements) {
        if (!el.tags?.name) continue;
        if (seenIds.has(el.id)) continue;
        
        // For generic office query, filter by name relevance
        if (!isPropertyManagement(el.tags.name) && 
            !namePatterns.some(p => el.tags!.name!.toLowerCase().includes(p.toLowerCase()))) {
          continue;
        }
        
        seenIds.add(el.id);
        allElements.push(el);
      }
    }
    
    console.log(`OSM: Batch ${batchNum}/${totalBatches} complete. Total results: ${allElements.length}`);
    
    // Small delay between batches
    if (i + concurrency < tiles.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  console.log(`OSM: Total unique results: ${allElements.length}`);
  return allElements;
}

export async function scrapeOSM(
  query: string,
  location: string
): Promise<ScrapedBusiness[]> {
  console.log(`OSM: Searching for "${query}" in "${location}"...`);
  
  const results: ScrapedBusiness[] = [];
  const seen = new Set<number>();
  
  const locationKey = location.toLowerCase().replace(/[\s-]/g, '');
  const bbox = CITY_BOUNDING_BOXES[locationKey];
  
  if (bbox) {
    console.log(`OSM: Found bounding box for ${location}, using multi-strategy tile search`);
    
    // 6x6 grid = 36 tiles for good coverage without too many API calls
    const tiles = splitBoundingBox(bbox, 6, 6);
    console.log(`OSM: Split into ${tiles.length} tiles`);
    
    try {
      const elements = await queryTilesMultiStrategy(tiles, query, 3);
      
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
      console.warn(`OSM: Multi-strategy search failed:`, err);
    }
  } else {
    console.log(`OSM: No bounding box for ${location}, trying fallback search`);
  }
  
  // Fallback: Global search
  try {
    const escapedQuery = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const fallbackOql = `
[out:json][timeout:25];
(
  node["name"~"${escapedQuery}",i]["office"];
  node["name"~"${escapedQuery}",i]["shop"];
  way["name"~"${escapedQuery}",i]["office"];
  node["office"="property_management"];
  node["office"="estate_agent"];
);
out center tags 100;
`;
    
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
