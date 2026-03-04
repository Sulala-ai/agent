"use client"

import { BookOpen, CalendarClock, LayoutDashboard, MessageSquare, Plug, Settings2 } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"

export type NavPage = "overview" | "tasks" | "logs" | "files" | "skills" | "jobs" | "chat" | "integrations" | "config" | "settings"

const mainNavItems: { page: NavPage; label: string; icon: typeof LayoutDashboard }[] = [
  { page: "chat", label: "AI Chat", icon: MessageSquare },
  { page: "skills", label: "Skills", icon: BookOpen },
  { page: "integrations", label: "Integrations", icon: Plug },
  { page: "jobs", label: "Jobs", icon: CalendarClock },
  { page: "settings", label: "Settings", icon: Settings2 },
]

export function AppSidebar({
  activePage,
  onNavigate,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  activePage: NavPage
  onNavigate: (page: NavPage) => void
}) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg p-1">
                <img src="/logo_white.svg" alt="" className="size-full object-contain dark:hidden" aria-hidden />
                <img src="/logo_white.svg" alt="" className="size-full object-contain hidden dark:block" aria-hidden />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Sulala Agent</span>
                <span className="truncate text-xs text-muted-foreground">Local AI orchestration</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarMenu>
            {mainNavItems.map((item) => (
              <SidebarMenuItem key={item.page}>
                <SidebarMenuButton
                  tooltip={item.label}
                  isActive={activePage === item.page}
                  onClick={() => onNavigate(item.page)}
                >
                  <item.icon className="size-4" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="text-muted-foreground cursor-default">
              <span className="truncate text-xs">127.0.0.1</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
