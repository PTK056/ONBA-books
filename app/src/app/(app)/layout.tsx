import { Suspense } from "react";
import { OrgName, PlacePicker, ReviewBadge, SidebarForRole, UserMenu } from "@/components/shell/ShellParts";
import { SidebarView } from "@/components/shell/Sidebar";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<SidebarView org="…" reviewBadge={null} user={null} path={null} />}>
        <SidebarForRole
          org={<Suspense fallback="…"><OrgName /></Suspense>}
          reviewBadge={<Suspense><ReviewBadge /></Suspense>}
          user={<Suspense><UserMenu /></Suspense>}
          place={<Suspense><PlacePicker /></Suspense>}
          placeCompact={<Suspense><PlacePicker compact /></Suspense>}
        />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">{children}</div>
    </div>
  );
}
