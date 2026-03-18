import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useState, useEffect, useRef } from "react";
import type { Business, SearchJob, Project } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Search, Download, Trash2, Phone, Globe, Mail,
  MapPin, RefreshCw, CheckCircle2, XCircle, Clock, Copy,
  Building2, Layers, Filter
} from "lucide-react";
import { Link } from "wouter";

type Source = "google" | "osm" | "gelbeseiten";

const SOURCE_LABELS: Record<Source, string> = {
  google: "Google Maps",
  osm: "OpenStreetMap",
  gelbeseiten: "Gelbe Seiten",
};

const SOURCE_BADGE_CLASS: Record<Source, string> = {
  google: "badge-google",
  osm: "badge-osm",
  gelbeseiten: "badge-gelbeseiten",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "done") return (
    <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
      <CheckCircle2 size={12} /> Fertig
    </span>
  );
  if (status === "running") return (
    <span className="flex items-center gap-1 text-xs text-primary animate-pulse">
      <RefreshCw size={12} className="animate-spin" /> Läuft...
    </span>
  );
  if (status === "error") return (
    <span className="flex items-center gap-1 text-xs text-destructive">
      <XCircle size={12} /> Fehler
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Clock size={12} /> Wartend
    </span>
  );
}

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [sources, setSources] = useState<Source[]>(["osm", "gelbeseiten"]);
  const [filterSource, setFilterSource] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [runningJobId, setRunningJobId] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: project } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects`);
      const projects: Project[] = await res.json();
      const p = projects.find((x) => x.id === projectId);
      if (!p) throw new Error("not found");
      return p;
    },
  });

  const { data: businesses = [], isLoading: bizLoading } = useQuery<Business[]>({
    queryKey: ["/api/projects", projectId, "businesses"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${projectId}/businesses`);
      return res.json();
    },
  });

  const { data: jobs = [] } = useQuery<SearchJob[]>({
    queryKey: ["/api/projects", projectId, "jobs"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${projectId}/jobs`);
      return res.json();
    },
  });

  const { data: stats } = useQuery<{
    total: number;
    bySource: Record<string, number>;
    totalDupsRemoved: number;
    withPhone: number;
    withWebsite: number;
    withEmail: number;
  }>({
    queryKey: ["/api/projects", projectId, "stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${projectId}/stats`);
      return res.json();
    },
  });

  // Poll for job status when running
  useEffect(() => {
    if (runningJobId !== null) {
      pollRef.current = setInterval(async () => {
        try {
          const res = await apiRequest("GET", `/api/jobs/${runningJobId}`);
          const job: SearchJob = await res.json();
          if (job.status === "done" || job.status === "error") {
            setRunningJobId(null);
            if (pollRef.current) clearInterval(pollRef.current);
            qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "businesses"] });
            qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "jobs"] });
            qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "stats"] });
            if (job.status === "done") {
              toast({
                title: "Suche abgeschlossen",
                description: `${job.totalFound} Betriebe gefunden, ${job.duplicatesRemoved} Duplikate entfernt.`,
              });
            } else {
              toast({ title: "Fehler bei der Suche", description: job.errorMessage || "Unbekannter Fehler", variant: "destructive" });
            }
          }
        } catch { /* ignore */ }
      }, 2500);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [runningJobId]);

  const searchMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/search", { projectId, query: query.trim(), location: location.trim(), sources }),
    onSuccess: async (res) => {
      const job: SearchJob = await res.json();
      setRunningJobId(job.id);
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "jobs"] });
      setQuery("");
      setLocation("");
    },
    onError: () => toast({ title: "Fehler", description: "Suche konnte nicht gestartet werden", variant: "destructive" }),
  });

  const deleteBizMutation = useMutation({
    mutationFn: (bizId: number) => apiRequest("DELETE", `/api/businesses/${bizId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "businesses"] });
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "stats"] });
    },
  });

  const handleExport = () => {
    window.open(`/api/projects/${projectId}/export/csv`, "_blank");
  };

  const toggleSource = (src: Source) => {
    setSources((prev) =>
      prev.includes(src) ? prev.filter((s) => s !== src) : [...prev, src]
    );
  };

  const filteredBiz = businesses.filter((b) => {
    const matchesSource = filterSource === "all" || b.source === filterSource;
    const matchesSearch = !search || [b.name, b.address, b.city, b.phone, b.website, b.email]
      .filter(Boolean)
      .some((val) => val!.toLowerCase().includes(search.toLowerCase()));
    return matchesSource && matchesSearch;
  });

  const isRunning = runningJobId !== null;
  const canSearch = query.trim() && location.trim() && sources.length > 0 && !isRunning;

  return (
    <div className="space-y-6">
      {/* Back + Title */}
      <div className="flex items-center gap-3">
        <Link href="/">
          <a className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-back">
            <ArrowLeft size={18} />
          </a>
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight" data-testid="text-project-title">
            {project?.name ?? "Laden..."}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {stats?.total ?? 0} Betriebe · {stats?.totalDupsRemoved ?? 0} Duplikate entfernt
          </p>
        </div>
      </div>

      {/* Search form */}
      <Card data-testid="card-search">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Neue Suche</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Branche</Label>
              <Input
                placeholder="z.B. Hausverwaltung"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSearch && searchMutation.mutate()}
                data-testid="input-query"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Ort / Stadt</Label>
              <Input
                placeholder="z.B. Berlin"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSearch && searchMutation.mutate()}
                data-testid="input-location"
              />
            </div>
          </div>

          {/* Source selection */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Quellen</Label>
            <div className="flex flex-wrap gap-4">
              {(["google", "osm", "gelbeseiten"] as Source[]).map((src) => (
                <div key={src} className="flex items-center gap-2">
                  <Checkbox
                    id={`src-${src}`}
                    checked={sources.includes(src)}
                    onCheckedChange={() => toggleSource(src)}
                    data-testid={`checkbox-source-${src}`}
                  />
                  <label htmlFor={`src-${src}`} className="text-sm cursor-pointer">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${SOURCE_BADGE_CLASS[src]}`}>
                      {SOURCE_LABELS[src]}
                    </span>
                  </label>
                </div>
              ))}
            </div>
            {sources.includes("google") && !process.env.GOOGLE_PLACES_API_KEY && (
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2 flex items-center gap-1">
                ⚠️ Google Maps benötigt einen API Key (env: GOOGLE_PLACES_API_KEY)
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              {isRunning && (
                <span className="flex items-center gap-1.5 text-xs text-primary">
                  <RefreshCw size={12} className="animate-spin" />
                  Suche läuft...
                </span>
              )}
            </div>
            <Button
              onClick={() => searchMutation.mutate()}
              disabled={!canSearch}
              size="sm"
              data-testid="button-search"
            >
              <Search size={14} className="mr-1.5" />
              {isRunning ? "Läuft..." : "Suchen"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Gesamt", value: stats.total, icon: Building2 },
            { label: "Mit Telefon", value: stats.withPhone, icon: Phone },
            { label: "Mit Website", value: stats.withWebsite, icon: Globe },
            { label: "Mit E-Mail", value: stats.withEmail, icon: Mail },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label} className="py-3">
              <CardContent className="pt-0 pb-0 flex items-center gap-3">
                <Icon size={16} className="text-primary flex-shrink-0" />
                <div>
                  <p className="text-lg font-bold leading-none" data-testid={`stat-${label}`}>{value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Jobs history */}
      {jobs.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2">Suchhistorie</h2>
          <div className="space-y-2">
            {jobs.slice(0, 5).map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between px-3 py-2 rounded-md border border-border bg-card text-sm"
                data-testid={`row-job-${job.id}`}
              >
                <div className="flex items-center gap-3">
                  <StatusBadge status={job.status} />
                  <span className="font-medium">{job.query}</span>
                  <span className="text-muted-foreground flex items-center gap-1">
                    <MapPin size={11} /> {job.location}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground text-right">
                  {job.status === "done" && (
                    <span>{job.totalFound} Treffer · {job.duplicatesRemoved} Dups</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results table */}
      {(bizLoading || businesses.length > 0) && (
        <div>
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Layers size={15} />
              Ergebnisse
              {filteredBiz.length > 0 && (
                <span className="text-muted-foreground font-normal">({filteredBiz.length})</span>
              )}
            </h2>
            <div className="flex items-center gap-2">
              {/* Source filter */}
              <div className="flex items-center gap-1.5">
                <Filter size={13} className="text-muted-foreground" />
                <select
                  className="text-xs bg-card border border-border rounded px-2 py-1 text-foreground"
                  value={filterSource}
                  onChange={(e) => setFilterSource(e.target.value)}
                  data-testid="select-filter-source"
                >
                  <option value="all">Alle Quellen</option>
                  <option value="google">Google Maps</option>
                  <option value="osm">OpenStreetMap</option>
                  <option value="gelbeseiten">Gelbe Seiten</option>
                </select>
              </div>
              <Input
                placeholder="Suchen..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 text-xs w-40"
                data-testid="input-filter-search"
              />
              <Button size="sm" variant="outline" onClick={handleExport} data-testid="button-export-csv">
                <Download size={13} className="mr-1.5" />
                CSV
              </Button>
            </div>
          </div>

          {bizLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : filteredBiz.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              Keine Ergebnisse.
            </div>
          ) : (
            <div className="table-scroll">
              <table className="biz-table" data-testid="table-businesses">
                <thead className="bg-muted/50">
                  <tr>
                    <th>Name</th>
                    <th>Adresse</th>
                    <th>Telefon</th>
                    <th>Website</th>
                    <th>Quelle</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBiz.map((biz) => (
                    <tr key={biz.id} data-testid={`row-biz-${biz.id}`}>
                      <td>
                        <div>
                          <p className="font-medium text-sm">{biz.name}</p>
                          {biz.category && (
                            <p className="text-xs text-muted-foreground">{biz.category}</p>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="text-sm">
                          {biz.address && <p>{biz.address}</p>}
                          {(biz.zip || biz.city) && (
                            <p className="text-muted-foreground">{[biz.zip, biz.city].filter(Boolean).join(" ")}</p>
                          )}
                        </div>
                      </td>
                      <td>
                        {biz.phone ? (
                          <a
                            href={`tel:${biz.phone}`}
                            className="text-sm text-primary hover:underline flex items-center gap-1"
                            data-testid={`link-phone-${biz.id}`}
                          >
                            <Phone size={11} />
                            {biz.phone}
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td>
                        {biz.website ? (
                          <a
                            href={biz.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline flex items-center gap-1 max-w-[180px] truncate"
                            data-testid={`link-website-${biz.id}`}
                          >
                            <Globe size={11} className="flex-shrink-0" />
                            {biz.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${SOURCE_BADGE_CLASS[biz.source as Source]}`}>
                          {SOURCE_LABELS[biz.source as Source] || biz.source}
                        </span>
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteBizMutation.mutate(biz.id)}
                          data-testid={`button-delete-biz-${biz.id}`}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!bizLoading && businesses.length === 0 && jobs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search size={36} className="text-muted-foreground opacity-30 mb-3" />
          <p className="text-sm text-muted-foreground">Noch keine Suche gestartet.</p>
          <p className="text-xs text-muted-foreground mt-1">Gib Branche und Ort ein und starte deine erste Suche.</p>
        </div>
      )}
    </div>
  );
}
