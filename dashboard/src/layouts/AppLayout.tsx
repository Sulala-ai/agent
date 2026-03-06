import { Button } from "@/components/ui/button";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar, type NavPage } from "@/components/app-sidebar";
import { useTheme } from "@/hooks/useTheme";

type AppLayoutProps = {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  error: string | null;
  children: React.ReactNode;
};

export function AppLayout({ activePage, onNavigate, error, children }: AppLayoutProps) {
  const { theme, toggle: toggleTheme } = useTheme();

  return (
    <SidebarProvider>
      <AppSidebar activePage={activePage} onNavigate={onNavigate} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "Light" : "Dark"}
          </Button>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6 w-full">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
