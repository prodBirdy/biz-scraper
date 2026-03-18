import * as cheerio from "cheerio";
import { chromium, Browser } from "playwright";
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

async function extractBusinessesFromHTML(
  html: string,
  query: string,
  location: string,
  seenIds: Set<string>
): Promise<{ businesses: ScrapedBusiness[]; count: number }> {
  const $ = cheerio.load(html);
  const results: ScrapedBusiness[] = [];
  let pageCount = 0;

  $("article.mod-Treffer, article[id^='treffer_']").each((_, el) => {
    try {
      const $el = $(el);

      const name =
        $el.find("h2.mod-Treffer__name").text().trim() ||
        $el.find("[data-wipe-name='Titel']").text().trim();

      if (!name) return;

      const sourceId =
        $el.attr("data-realid") ||
        $el.attr("data-teilnehmerid") ||
        $el.attr("id")?.replace("treffer_", "");

      if (sourceId && seenIds.has(sourceId)) {
        return;
      }
      if (sourceId) {
        seenIds.add(sourceId);
      }

      let phone: string | undefined;
      let email: string | undefined;
      let street: string | undefined;
      let zip: string | undefined;
      let city: string | undefined;

      const dataParams = $el.find("[data-parameters]").first().attr("data-parameters");
      if (dataParams) {
        try {
          const params: GsParameters = JSON.parse(dataParams);
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

      if (!phone) {
        const prgAttr = $el.find(".mod-TelefonnummerKompakt [data-prg]").attr("data-prg");
        if (prgAttr) {
          const decoded = decodeBase64(prgAttr);
          if (decoded && !decoded.startsWith("http")) {
            phone = decoded.trim();
          }
        }
      }

      let website: string | undefined;
      const wsAttr = $el.find("[data-webseitelink]").attr("data-webseitelink");
      if (wsAttr) {
        const decoded = decodeBase64(wsAttr);
        if (decoded.startsWith("http")) website = decoded;
      }

      if (!street) {
        street = $el.find("[itemprop='streetAddress']").text().trim() || undefined;
      }
      if (!zip) {
        zip = $el.find("[itemprop='postalCode']").text().trim() || undefined;
      }
      if (!city) {
        city = $el.find("[itemprop='addressLocality']").text().trim() || location;
      }

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

  return { businesses: results, count: pageCount };
}

async function scrapeGelbeSeitenSingleQuery(
  query: string,
  location: string,
  maxLoadMoreClicks: number = 100
): Promise<ScrapedBusiness[]> {
  const results: ScrapedBusiness[] = [];
  const seenIds = new Set<string>();
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    const url = `https://www.gelbeseiten.de/suche/${encodeURIComponent(query)}/${encodeURIComponent(location)}`;
    console.log(`Gelbe Seiten: Navigating to ${url}`);

    await page.goto(url, { waitUntil: "networkidle" });

    // Wait for initial results to load
    await page.waitForSelector("article.mod-Treffer, article[id^='treffer_']", { timeout: 10000 });

    // Extract initial results
    let html = await page.content();
    let extraction = await extractBusinessesFromHTML(html, query, location, seenIds);
    results.push(...extraction.businesses);
    console.log(`Gelbe Seiten: Initial load - ${extraction.count} entries (total: ${results.length})`);

    // Click "Mehr Anzeigen" button repeatedly
    let loadMoreClicks = 0;

    while (loadMoreClicks < maxLoadMoreClicks) {
      // Check if load more button exists and is visible
      const loadMoreButton = await page.locator("#mod-LoadMore--button.mod-LoadMore--button").first();
      
      const buttonCount = await loadMoreButton.count();
      if (buttonCount === 0) {
        console.log("Gelbe Seiten: No more 'Mehr Anzeigen' button found");
        break;
      }

      // Check if button is visible
      const isVisible = await loadMoreButton.isVisible().catch(() => false);
      if (!isVisible) {
        console.log("Gelbe Seiten: 'Mehr Anzeigen' button is not visible");
        break;
      }

      // Click the button
      loadMoreClicks++;
      console.log(`Gelbe Seiten: Clicking 'Mehr Anzeigen' (${loadMoreClicks}/${maxLoadMoreClicks})`);
      
      try {
        await loadMoreButton.click();
        
        // Wait for new content to load
        await page.waitForTimeout(3000);
        
        // Scroll to bottom to ensure all content is loaded
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
        
        // Extract results - only add new ones (seenIds prevents duplicates)
        html = await page.content();
        const previousCount = results.length;
        extraction = await extractBusinessesFromHTML(html, query, location, seenIds);
        
        // Append only new unique results
        results.push(...extraction.businesses);
        
        const newCount = results.length - previousCount;
        console.log(`Gelbe Seiten: After click ${loadMoreClicks} - ${newCount} new entries (total: ${results.length})`);

        // If no new results, stop
        if (newCount === 0) {
          console.log("Gelbe Seiten: No new results loaded, stopping");
          break;
        }
      } catch (err) {
        console.warn("Gelbe Seiten: Error clicking load more button:", err);
        break;
      }
    }

    console.log(`Gelbe Seiten total: ${results.length} for "${query}" in "${location}"`);
    return results;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function scrapeGelbeSeiten(
  query: string,
  location: string
): Promise<ScrapedBusiness[]> {
  // Generate multiple query variants for better coverage
  const queryLower = query.toLowerCase();
  const queries: string[] = [];
  
  if (queryLower.includes('hausverwaltung') || queryLower.includes('verwaltung')) {
    queries.push(
      'Hausverwaltung',
      'Immobilienverwaltung',
      'Wohnungsverwaltung',
      'Liegenschaftsverwaltung',
      'Grundstuecksverwaltung',
      'Siedlergemeinschaft'
    );
  } else {
    queries.push(query);
  }

  console.log(`Gelbe Seiten: Searching with ${queries.length} query variants`);

  // Run queries sequentially to avoid overwhelming the site
  const allResults: ScrapedBusiness[] = [];
  const seenGlobalIds = new Set<string>();

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    console.log(`Gelbe Seiten: Query ${i + 1}/${queries.length} - "${q}"`);
    
    try {
      const results = await scrapeGelbeSeitenSingleQuery(q, location, 60);
      console.log(`Gelbe Seiten: Query ${i + 1} returned ${results.length} results`);
      
      // Merge and deduplicate
      for (const business of results) {
        const uniqueId = business.sourceId || business.name + business.address;
        if (!seenGlobalIds.has(uniqueId)) {
          seenGlobalIds.add(uniqueId);
          allResults.push(business);
        }
      }
    } catch (err) {
      console.warn(`Gelbe Seiten: Query ${i + 1} failed:`, err);
    }

    // Delay between queries
    if (i < queries.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`Gelbe Seiten: Total unique results: ${allResults.length}`);
  return allResults;
}
