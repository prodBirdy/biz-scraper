import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppLayout } from "@/components/AppLayout";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectPage } from "@/pages/ProjectPage";
import NotFound from "@/pages/not-found";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Router hook={useHashLocation}>
          <AppLayout>
            <Switch>
              <Route path="/" component={ProjectsPage} />
              <Route path="/projects/:id" component={ProjectPage} />
              <Route component={NotFound} />
            </Switch>
          </AppLayout>
        </Router>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
