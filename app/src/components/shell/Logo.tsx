import { BookOpenCheck } from "lucide-react";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm">
        <BookOpenCheck size={16} strokeWidth={2.25} />
      </span>
      ONBA Books
    </span>
  );
}
