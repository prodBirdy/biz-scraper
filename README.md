# BizScraper

Business address finder — searches multiple sources simultaneously for companies by industry and location.

## Features

- **3 data sources:** Google Maps (Places API), OpenStreetMap (Overpass), Gelbe Seiten
- **Deduplication:** Levenshtein distance on names + phone/website/geo matching — merges best available data
- **CSV export** with UTF-8 BOM (Excel-compatible, includes phone, email, website, address)
- **Project-based organization** — group multiple searches together
- **Search history** per project with stats (total found, duplicates removed)
- Dark / light mode

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Tailwind CSS, shadcn/ui, TanStack Query |
| Backend | Express + TypeScript |
| Scrapers | Overpass API (OSM), Gelbe Seiten (cheerio), Google Places API |
| Build | Vite + esbuild |

## Getting Started

```bash
npm install
npm run dev
```

Server runs on `http://localhost:5000`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | No | Enables Google Maps source. Get one at [console.cloud.google.com](https://console.cloud.google.com) |

OpenStreetMap and Gelbe Seiten work without any API key.

## Project Structure

```
├── client/          # React frontend
│   └── src/
│       ├── pages/   # ProjectsPage, ProjectPage
│       └── components/
├── server/          # Express backend
│   ├── scrapers/    # google.ts, osm.ts, gelbeseiten.ts, dedup.ts
│   ├── routes.ts    # API endpoints
│   └── storage.ts   # In-memory storage (swap for DB easily)
└── shared/
    └── schema.ts    # Drizzle schema (Projects, Businesses, SearchJobs)
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create project |
| `DELETE` | `/api/projects/:id` | Delete project + cascade |
| `GET` | `/api/projects/:id/businesses` | Get all businesses in project |
| `POST` | `/api/search` | Start a scrape job (async) |
| `GET` | `/api/jobs/:id` | Poll job status |
| `GET` | `/api/projects/:id/export/csv` | Download CSV |
| `GET` | `/api/projects/:id/stats` | Stats (total, by source, with phone/email/website) |

## OSM Tag Mapping

The OSM scraper automatically maps German branch names to the correct OSM tags:

| Query contains | OSM tag |
|---|---|
| Hausverwaltung, Immobilien | `office=property_management` + `office=estate_agent` |
| Zahnarzt | `amenity=dentist` |
| Apotheke | `amenity=pharmacy` |
| Rechtsanwalt | `amenity=lawyer` |
| Steuerberater | `office=tax_advisor` |
| Friseur | `shop=hairdresser` |
| ...and more | see `server/scrapers/osm.ts` |

## License

MIT
