import { Suspense } from "react";
import { OrgName, ReviewBadge, UserMenu } from "@/components/shell/ShellParts";
import { Sidebar } from "@/components/shell/Sidebar";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Sidebar
        org={<Suspense fallback="…"><OrgName /></Suspense>}
        reviewBadge={<Suspense><ReviewBadge /></Suspense>}
        user={<Suspense><UserMenu /></Suspense>}
      />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">{children}</div>
    </div>
  );
}
