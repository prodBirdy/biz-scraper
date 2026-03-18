import { Link, useLocation } from "wouter";
import { useTheme } from "./ThemeProvider";
import { Sun, Moon, MapPin, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import PerplexityAttribution from "./PerplexityAttribution";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  const [location] = useLocation();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <Link href="/">
            <a className="flex items-center gap-2.5 hover:opacity-80 transition-opacity" data-testid="link-home">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="BizScraper Logo">
                <rect width="28" height="28" rx="6" fill="hsl(var(--primary))" />
                <path d="M8 8h8a4 4 0 0 1 0 8H8V8z" fill="white" fillOpacity="0.95"/>
                <path d="M8 16h10a4 4 0 0 1 0 8H8v-8z" fill="white" fillOpacity="0.6"/>
                <circle cx="20" cy="20" r="2" fill="white"/>
              </svg>
              <span className="font-semibold text-base tracking-tight">BizScraper</span>
            </a>
          </Link>

          <nav className="flex items-center gap-1">
            <Link href="/">
              <a
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  location === "/" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
                data-testid="nav-projects"
              >
                <FolderOpen size={15} />
                Projekte
              </a>
            </Link>
          </nav>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            data-testid="button-theme-toggle"
            className="h-8 w-8"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card mt-auto py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <MapPin size={12} />
            <span>Business Address Finder</span>
          </div>
          <a
            href="https://www.perplexity.ai/computer"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            Created with Perplexity Computer
          </a>
        </div>
      </footer>
    </div>
  );
}
