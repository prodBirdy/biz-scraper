import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { scrapeGoogle } from "./scrapers/google";
import { scrapeOSM } from "./scrapers/osm";
import { scrapeGelbeSeiten } from "./scrapers/gelbeseiten";
import { deduplicateBusinesses } from "./scrapers/dedup";
import type { ScrapedBusiness } from "./scrapers/types";
import { insertProjectSchema } from "@shared/schema";
import { z } from "zod";

export function registerRoutes(httpServer: Server, app: Express) {
  // ── Projects ──────────────────────────────────────────────────────────────
  app.get("/api/projects", async (_req, res) => {
    const projects = await storage.getProjects();
    res.json(projects);
  });

  app.post("/api/projects", async (req, res) => {
    const parsed = insertProjectSchema.safeParse({
      ...req.body,
      createdAt: new Date().toISOString(),
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const project = await storage.createProject(parsed.data);
    res.json(project);
  });

  app.delete("/api/projects/:id", async (req, res) => {
    await storage.deleteProject(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Businesses ────────────────────────────────────────────────────────────
  app.get("/api/projects/:id/businesses", async (req, res) => {
    const businesses = await storage.getBusinessesByProject(Number(req.params.id));
    res.json(businesses);
  });

  app.delete("/api/businesses/:id", async (req, res) => {
    await storage.deleteBusiness(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Search Jobs ───────────────────────────────────────────────────────────
  app.get("/api/projects/:id/jobs", async (req, res) => {
    const jobs = await storage.getSearchJobsByProject(Number(req.params.id));
    res.json(jobs);
  });

  const searchSchema = z.object({
    projectId: z.number(),
    query: z.string().min(1),
    location: z.string().min(1),
    sources: z.array(z.enum(["google", "osm", "gelbeseiten"])).min(1),
  });

  app.post("/api/search", async (req, res) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { projectId, query, location, sources } = parsed.data;

    const job = await storage.createSearchJob({
      projectId,
      query,
      location,
      sources: JSON.stringify(sources),
      status: "running",
      createdAt: new Date().toISOString(),
    });

    // Return job immediately, run scraping async
    res.json(job);

    // ── Background scraping ──────────────────────────────────────────────────
    (async () => {
      try {
        const allResults: ScrapedBusiness[] = [];
        const sourceResults: Record<string, number> = {};

        console.log(`\n🔍 Starting search for "${query}" in "${location}"`);
        console.log(`📊 Sources: ${sources.join(", ")}\n`);

        const tasks = sources.map(async (src) => {
          try {
            console.log(`🚀 Starting ${src} scraper...`);
            let results: ScrapedBusiness[] = [];
            
            if (src === "google") results = await scrapeGoogle(query, location);
            else if (src === "osm") results = await scrapeOSM(query, location);
            else if (src === "gelbeseiten") results = await scrapeGelbeSeiten(query, location);
            
            sourceResults[src] = results.length;
            console.log(`✅ ${src}: Found ${results.length} businesses`);
            return results;
          } catch (e) {
            console.error(`❌ Scraper ${src} failed:`, e);
            sourceResults[src] = 0;
            return [];
          }
        });

        const results = await Promise.all(tasks);
        for (const r of results) allResults.push(...r);

        console.log(`\n📈 Results by source:`);
        for (const [src, count] of Object.entries(sourceResults)) {
          console.log(`   ${src}: ${count}`);
        }
        console.log(`   Total before deduplication: ${allResults.length}\n`);

        // Deduplicate
        const { unique, totalMerged } = deduplicateBusinesses(allResults);

        console.log(`🧹 Deduplication: Removed ${totalMerged} duplicates`);
        console.log(`💾 Saving ${unique.length} unique businesses...\n`);

        // Persist
        const toInsert = unique.map((b) => ({
          projectId,
          name: b.name,
          address: b.address,
          city: b.city,
          zip: b.zip,
          phone: b.phone,
          email: b.email,
          website: b.website,
          category: b.category,
          source: b.source,
          sourceId: b.sourceId,
          lat: b.lat,
          lng: b.lng,
          isDuplicate: false,
          rawData: b.rawData as Record<string, unknown>,
        }));

        await storage.createBusinessesBatch(toInsert);

        await storage.updateSearchJob(job.id, {
          status: "done",
          totalFound: unique.length,
          duplicatesRemoved: totalMerged,
          finishedAt: new Date().toISOString(),
        });

        console.log(`✨ Search completed! Found ${unique.length} unique businesses\n`);
      } catch (err) {
        console.error(`💥 Search failed:`, err);
        await storage.updateSearchJob(job.id, {
          status: "error",
          errorMessage: String(err),
          finishedAt: new Date().toISOString(),
        });
      }
    })();
  });

  app.get("/api/jobs/:id", async (req, res) => {
    const job = await storage.getSearchJob(Number(req.params.id));
    if (!job) return res.status(404).json({ error: "not found" });
    res.json(job);
  });

  // ── CSV Export ────────────────────────────────────────────────────────────
  app.get("/api/projects/:id/export/csv", async (req, res) => {
    const businesses = await storage.getBusinessesByProject(Number(req.params.id));

    const headers = ["Name", "Adresse", "Stadt", "PLZ", "Telefon", "E-Mail", "Website", "Kategorie", "Quelle", "Lat", "Lng"];
    const rows = businesses.map((b) => [
      b.name,
      b.address ?? "",
      b.city ?? "",
      b.zip ?? "",
      b.phone ?? "",
      b.email ?? "",
      b.website ?? "",
      b.category ?? "",
      b.source,
      b.lat ?? "",
      b.lng ?? "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));

    const csv = [headers.join(","), ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="businesses.csv"`);
    res.send("\uFEFF" + csv); // BOM for Excel UTF-8
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  app.get("/api/projects/:id/stats", async (req, res) => {
    const businesses = await storage.getBusinessesByProject(Number(req.params.id));
    const jobs = await storage.getSearchJobsByProject(Number(req.params.id));

    const bySource: Record<string, number> = {};
    for (const b of businesses) {
      bySource[b.source] = (bySource[b.source] || 0) + 1;
    }

    const totalDupsRemoved = jobs.reduce((sum, j) => sum + (j.duplicatesRemoved || 0), 0);

    res.json({
      total: businesses.length,
      bySource,
      totalDupsRemoved,
      withPhone: businesses.filter((b) => b.phone).length,
      withWebsite: businesses.filter((b) => b.website).length,
      withEmail: businesses.filter((b) => b.email).length,
    });
  });

  // ── Seed (dev only) ───────────────────────────────────────────────────────
  app.post("/api/projects/:id/seed", async (req, res) => {
    const projectId = Number(req.params.id);
    const demo: Array<{name: string; address?: string; city?: string; zip?: string; phone?: string; website?: string; email?: string | null; source: "google"|"osm"|"gelbeseiten"; category?: string}> = [
      { name: "Berliner Hausverwaltung GmbH", address: "Unter den Linden 12", city: "Berlin", zip: "10117", phone: "+49 30 123456", website: "https://berliner-hv.de", source: "gelbeseiten", category: "Hausverwaltung" },
      { name: "Immobilien & Verwaltung Koch", address: "Alexanderplatz 5", city: "Berlin", zip: "10178", phone: "+49 30 876543", website: "https://immo-koch.de", email: "info@immo-koch.de", source: "gelbeseiten", category: "Hausverwaltung" },
      { name: "Hausverwaltung Mitte GmbH", address: "Karl-Liebknecht-Str. 9", city: "Berlin", zip: "10178", source: "osm", category: "office" },
      { name: "Prenzlauer Berg Verwaltungen AG", address: "Schönhauser Allee 88", city: "Berlin", zip: "10439", phone: "+49 30 445566", source: "osm", category: "office" },
      { name: "Alpha Hausverwaltungs GmbH", address: "Friedrichstr. 100", city: "Berlin", zip: "10117", website: "https://alpha-hv.de", email: "info@alpha-hv.de", source: "google", category: "real_estate_agency" },
      { name: "Wohnraum Berlin Verwaltung", address: "Torstr. 225", city: "Berlin", zip: "10115", phone: "+49 30 778899", website: "https://wohnraum-berlin.de", source: "google", category: "real_estate_agency" },
      { name: "Verwaltungsgesellschaft Nord GmbH", address: "Müllerstr. 50", city: "Berlin", zip: "13349", phone: "+49 30 332211", source: "gelbeseiten", category: "Hausverwaltung" },
    ];
    for (const b of demo) {
      await storage.createBusiness({ ...b, projectId, isDuplicate: false, sourceId: null, lat: null, lng: null, rawData: null, email: b.email ?? null });
    }
    res.json({ seeded: demo.length });
  });
}
