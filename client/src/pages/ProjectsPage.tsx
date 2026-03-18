import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useState } from "react";
import type { Project } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FolderOpen, Plus, Trash2, ChevronRight, Building2 } from "lucide-react";

export function ProjectsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string }) =>
      apiRequest("POST", "/api/projects", data),
    onSuccess: async (res) => {
      const project = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setShowCreate(false);
      setName("");
      navigate(`/projects/${project.id}`);
    },
    onError: () => toast({ title: "Fehler", description: "Projekt konnte nicht erstellt werden", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/projects/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
    onError: () => toast({ title: "Fehler", description: "Projekt konnte nicht gelöscht werden", variant: "destructive" }),
  });

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Projekte</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Organisiere deine Branchen-Suchen in Projekten
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm" data-testid="button-new-project">
          <Plus size={15} className="mr-1.5" />
          Neues Projekt
        </Button>
      </div>

      {/* Project grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-28 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Building2 size={40} className="text-muted-foreground mb-3 opacity-40" />
          <p className="text-muted-foreground text-sm">Noch keine Projekte.</p>
          <p className="text-muted-foreground text-sm">Erstelle dein erstes Projekt um zu starten.</p>
          <Button className="mt-4" size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} className="mr-1.5" />
            Projekt erstellen
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <Card
              key={project.id}
              className="cursor-pointer hover:border-primary/50 transition-colors group"
              onClick={() => navigate(`/projects/${project.id}`)}
              data-testid={`card-project-${project.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <FolderOpen size={16} className="text-primary mt-0.5 flex-shrink-0" />
                    <CardTitle className="text-sm font-semibold" data-testid={`text-project-name-${project.id}`}>
                      {project.name}
                    </CardTitle>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMutation.mutate(project.id);
                    }}
                    data-testid={`button-delete-project-${project.id}`}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {new Date(project.createdAt).toLocaleDateString("de-AT", {
                    day: "2-digit", month: "2-digit", year: "numeric"
                  })}
                </p>
                <div className="flex items-center justify-end mt-3">
                  <span className="text-xs text-primary font-medium flex items-center gap-1">
                    Öffnen <ChevronRight size={12} />
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-create-project">
          <DialogHeader>
            <DialogTitle>Neues Projekt</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="z.B. Hausverwaltungen Berlin"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && createMutation.mutate({ name: name.trim() })}
              autoFocus
              data-testid="input-project-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Abbrechen</Button>
            <Button
              onClick={() => createMutation.mutate({ name: name.trim() })}
              disabled={!name.trim() || createMutation.isPending}
              data-testid="button-create-project"
            >
              {createMutation.isPending ? "Erstelle..." : "Erstellen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
