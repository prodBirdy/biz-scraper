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

// Two Overpass endpoints for fallback
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async function runOverpassQuery(oql: string): Promise<OverpassResponse> {
  const body = new URLSearchParams({ data: oql });

  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 5000 * attempt));

        const resp = await fetch(endpoint, {
          method: "POST",
          body: body.toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: AbortSignal.timeout(35000),
        });

        if (resp.status === 429) {
          await new Promise((r) => setTimeout(r, 15000));
          continue;
        }

        if (resp.status === 504 || resp.status === 502 || resp.status === 503) {
          // Gateway error — try next endpoint
          break;
        }

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`Overpass HTTP ${resp.status}: ${text.slice(0, 200)}`);
        }

        return resp.json() as Promise<OverpassResponse>;
      } catch (err) {
        if (attempt === 1) throw err;
      }
    }
  }

  throw new Error("All Overpass endpoints failed");
}

export async function scrapeOSM(
  query: string,
  location: string
): Promise<ScrapedBusiness[]> {
  try {
    const tagFilter = inferOsmTagFilter(query);
    const escapedQuery = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    // Strategy: Run TWO queries and merge results
    // Query 1: tag-based (most accurate for known Branchen)
    // Query 2: name-based (catches anything with the word in the name)
    // Use admin_level 4 for Bundesland/Stadtstaaten (Berlin, Hamburg)
    // and admin_level 6 for regular cities

    const results: ScrapedBusiness[] = [];
    const seen = new Set<number>();

    const adminLevels = ["4", "6", "8"];

    for (const level of adminLevels) {
      let oql: string;

      if (tagFilter) {
        oql = `
[out:json][timeout:30];
area["name"="${location}"]["admin_level"="${level}"]->.a;
(
  node${tagFilter}(area.a);
  way${tagFilter}(area.a);
  relation${tagFilter}(area.a);
  node["name"~"${escapedQuery}",i](area.a);
  way["name"~"${escapedQuery}",i](area.a);
);
out center tags;
`;
      } else {
        oql = `
[out:json][timeout:30];
area["name"="${location}"]["admin_level"="${level}"]->.a;
(
  node["name"~"${escapedQuery}",i]["office"](area.a);
  node["name"~"${escapedQuery}",i]["amenity"](area.a);
  node["name"~"${escapedQuery}",i]["shop"](area.a);
  node["name"~"${escapedQuery}",i]["craft"](area.a);
  way["name"~"${escapedQuery}",i]["office"](area.a);
  way["name"~"${escapedQuery}",i]["amenity"](area.a);
);
out center tags;
`;
      }

      try {
        const data = await runOverpassQuery(oql);

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

        // If we found results with this admin_level, no need to try others
        if (results.length > 0) break;

        // Polite delay between admin_level retries
        await new Promise((r) => setTimeout(r, 1000));
      } catch (levelErr) {
        console.warn(`OSM admin_level ${level} failed:`, levelErr);
        // continue to next level
      }
    }

    console.log(`OSM found ${results.length} results for "${query}" in "${location}"`);
    return results;
  } catch (err) {
    console.error("OSM scraper error:", err);
    return [];
  }
}
