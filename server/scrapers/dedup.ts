import type { ScrapedBusiness } from "./types";

// Levenshtein distance for fuzzy name comparison
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bgesellschaft\b/g, "ges")
    .replace(/\bmbh\b/g, "")
    .replace(/\bgmbh\b/g, "")
    .replace(/\bkg\b/g, "")
    .replace(/\bag\b/g, "")
    .replace(/&/g, "und")
    .replace(/[^a-z0-9äöüß ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

function phoneNormalize(p: string): string {
  return p.replace(/[\s\-\+\(\)\/]/g, "").replace(/^0049/, "0").replace(/^49/, "0");
}

export interface DedupResult {
  unique: ScrapedBusiness[];
  duplicates: Array<{ business: ScrapedBusiness; duplicateOf: ScrapedBusiness }>;
  totalMerged: number;
}

export function deduplicateBusinesses(businesses: ScrapedBusiness[]): DedupResult {
  const unique: ScrapedBusiness[] = [];
  const duplicates: Array<{ business: ScrapedBusiness; duplicateOf: ScrapedBusiness }> = [];

  for (const biz of businesses) {
    let isDuplicate = false;

    for (const existing of unique) {
      let score = 0;

      // Name similarity (primary signal)
      const nameSim = similarity(biz.name, existing.name);
      score += nameSim * 0.5;

      // Phone match (strong signal)
      if (biz.phone && existing.phone) {
        const pA = phoneNormalize(biz.phone);
        const pB = phoneNormalize(existing.phone);
        if (pA === pB && pA.length > 5) {
          score += 0.4;
        }
      }

      // Website match
      if (biz.website && existing.website) {
        const wA = biz.website.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
        const wB = existing.website.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
        if (wA === wB) score += 0.3;
      }

      // Address similarity
      if (biz.address && existing.address) {
        const addrSim = similarity(biz.address, existing.address);
        score += addrSim * 0.2;
      }

      // Geo proximity (within ~100m)
      if (biz.lat && biz.lng && existing.lat && existing.lng) {
        const dLat = Math.abs(parseFloat(biz.lat) - parseFloat(existing.lat));
        const dLng = Math.abs(parseFloat(biz.lng) - parseFloat(existing.lng));
        if (dLat < 0.001 && dLng < 0.001) {
          score += 0.2;
        }
      }

      // Threshold: 0.65 = likely duplicate
      if (score >= 0.65 || nameSim >= 0.92) {
        isDuplicate = true;
        duplicates.push({ business: biz, duplicateOf: existing });

        // Merge best available data into existing entry
        if (!existing.phone && biz.phone) existing.phone = biz.phone;
        if (!existing.email && biz.email) existing.email = biz.email;
        if (!existing.website && biz.website) existing.website = biz.website;
        if (!existing.zip && biz.zip) existing.zip = biz.zip;
        if (!existing.lat && biz.lat) existing.lat = biz.lat;
        if (!existing.lng && biz.lng) existing.lng = biz.lng;

        break;
      }
    }

    if (!isDuplicate) {
      unique.push({ ...biz });
    }
  }

  return {
    unique,
    duplicates,
    totalMerged: duplicates.length,
  };
}
