import * as cheerio from "cheerio";
import type { ScrapedBusiness } from "./types";

function decodeBase64(b64: string): string {
  try {
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

interface GsInboxConfig {
  generic?: {
    name?: string;
    street?: string;
    zip?: string;
    city?: string;
    phones?: string[];
    email?: string;
  };
}

interface GsParameters {
  inboxConfig?: GsInboxConfig;
}

export async function scrapeGelbeSeiten(
  query: string,
  location: string,
  maxPages: number = Number.MAX_SAFE_INTEGER
): Promise<ScrapedBusiness[]> {
  const results: ScrapedBusiness[] = [];
  const seenIds = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    try {
      // Gelbe Seiten URL format: /suche/{query}/{location}?von={offset}
      const from = (page - 1) * 25 + 1;
      const url =
        page === 1
          ? `https://www.gelbeseiten.de/suche/${encodeURIComponent(query)}/${encodeURIComponent(location)}`
          : `https://www.gelbeseiten.de/suche/${encodeURIComponent(query)}/${encodeURIComponent(location)}?von=${from}`;

      const resp = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Upgrade-Insecure-Requests": "1",
          Referer: "https://www.google.de/",
        },
      });

      if (!resp.ok) {
        console.warn(`Gelbe Seiten page ${page} returned HTTP ${resp.status}`);
        break;
      }

      const html = await resp.text();
      const $ = cheerio.load(html);

      let pageCount = 0;

      // Primary selector: article.mod-Treffer
      $("article.mod-Treffer, article[id^='treffer_']").each((_, el) => {
        try {
          const $el = $(el);

          // Name from h2.mod-Treffer__name or data-wipe-name="Titel"
          const name =
            $el.find("h2.mod-Treffer__name").text().trim() ||
            $el.find("[data-wipe-name='Titel']").text().trim();

          if (!name) return;
          
          // Get unique ID for deduplication
          const sourceId =
            $el.attr("data-realid") ||
            $el.attr("data-teilnehmerid") ||
            $el.attr("id")?.replace("treffer_", "");
          
          if (sourceId && seenIds.has(sourceId)) {
            return; // Skip duplicate
          }
          if (sourceId) {
            seenIds.add(sourceId);
          }

          // ── Data extraction: Gelbe Seiten encodes structured data in data-parameters ──
          // The data-parameters JSON contains full contact details
          let phone: string | undefined;
          let email: string | undefined;
          let street: string | undefined;
          let zip: string | undefined;
          let city: string | undefined;

          const dataParams = $el.find("[data-parameters]").first().attr("data-parameters");
          if (dataParams) {
            try {
              // data-parameters may contain HTML entities — cheerio handles those
              const params: GsParameters = JSON.parse(dataParams);
              // Address data is at inboxConfig.organizationQuery.generic (not inboxConfig.generic)
              const generic = (params as any)?.inboxConfig?.organizationQuery?.generic || params.inboxConfig?.generic;
              if (generic) {
                phone = generic.phones?.[0];
                email = generic.email;
                street = generic.street;
                zip = generic.zip;
                city = generic.city;
              }
            } catch {
              // ignore parse errors
            }
          }

          // Phone fallback: data-prg on the phone button (base64 encoded phone number)
          if (!phone) {
            const prgAttr = $el.find(".mod-TelefonnummerKompakt [data-prg]").attr("data-prg");
            if (prgAttr) {
              const decoded = decodeBase64(prgAttr);
              // The decoded value is the phone number if it looks like a phone (not a URL)
              if (decoded && !decoded.startsWith("http")) {
                phone = decoded.trim();
              }
            }
          }

          // Website: data-webseitelink is base64 encoded URL (note: cheerio normalizes to lowercase)
          let website: string | undefined;
          const wsAttr = $el.find("[data-webseitelink]").attr("data-webseitelink");
          if (wsAttr) {
            const decoded = decodeBase64(wsAttr);
            if (decoded.startsWith("http")) website = decoded;
          }

          // Address fallback from itemprop (sometimes present)
          if (!street) {
            street = $el.find("[itemprop='streetAddress']").text().trim() || undefined;
          }
          if (!zip) {
            zip = $el.find("[itemprop='postalCode']").text().trim() || undefined;
          }
          if (!city) {
            city = $el.find("[itemprop='addressLocality']").text().trim() || location;
          }

          // Category / branch
          const category =
            $el.find(".mod-Treffer--besteBranche").text().trim() ||
            $el.find(".mod-Treffer__branche").text().trim() ||
            query;

          results.push({
            name,
            address: street || undefined,
            city: city || location,
            zip: zip || undefined,
            phone: phone || undefined,
            email: email || undefined,
            website: website || undefined,
            source: "gelbeseiten",
            sourceId: sourceId || undefined,
            category: category || query,
          });

          pageCount++;
        } catch (err) {
          console.warn("GS entry parse error:", err);
        }
      });

      console.log(`Gelbe Seiten page ${page}: found ${pageCount} entries`);

      if (pageCount === 0) {
        // No results on this page → stop
        break;
      }

      // Check for next page pagination
      const hasNext =
        $(".pagination .next, .mod-Navigation__item--weiter, a[rel='next']").length > 0;
      if (!hasNext && page > 1) break;

      // Polite delay between pages
      if (page < maxPages) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (err) {
      console.error(`Gelbe Seiten error on page ${page}:`, err);
      break;
    }
  }

  console.log(`Gelbe Seiten total: ${results.length} for "${query}" in "${location}"`);
  return results;
}
