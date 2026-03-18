export interface ScrapedBusiness {
  name: string;
  address?: string;
  city?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  category?: string;
  source: "google" | "osm" | "gelbeseiten";
  sourceId?: string;
  lat?: string;
  lng?: string;
  rawData?: unknown;
}
