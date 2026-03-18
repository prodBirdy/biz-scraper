import { pgTable, text, integer, boolean, jsonb, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Projects (Sammlung von Suchergebnissen) ──────────────────────────────────
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// ── Businesses ───────────────────────────────────────────────────────────────
export const businesses = pgTable("businesses", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  zip: text("zip"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  category: text("category"),
  source: text("source").notNull(),           // "google" | "osm" | "gelbeseiten"
  sourceId: text("source_id"),
  lat: text("lat"),
  lng: text("lng"),
  isDuplicate: boolean("is_duplicate").notNull().default(false),
  duplicateOfId: integer("duplicate_of_id"),
  rawData: jsonb("raw_data"),
});

export const insertBusinessSchema = createInsertSchema(businesses).omit({ id: true });
export type InsertBusiness = z.infer<typeof insertBusinessSchema>;
export type Business = typeof businesses.$inferSelect;

// ── Search Jobs ───────────────────────────────────────────────────────────────
export const searchJobs = pgTable("search_jobs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  query: text("query").notNull(),         // z.B. "Hausverwaltung"
  location: text("location").notNull(),   // z.B. "Berlin"
  sources: text("sources").notNull(),     // JSON array: ["google","osm","gelbeseiten"]
  status: text("status").notNull().default("pending"), // pending | running | done | error
  totalFound: integer("total_found").default(0),
  duplicatesRemoved: integer("duplicates_removed").default(0),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
  errorMessage: text("error_message"),
});

export const insertSearchJobSchema = createInsertSchema(searchJobs).omit({ id: true });
export type InsertSearchJob = z.infer<typeof insertSearchJobSchema>;
export type SearchJob = typeof searchJobs.$inferSelect;
