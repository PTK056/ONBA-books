/** The Splyce wordmark: Gloock, with the accent dot. */
export function Logo({ className = "text-2xl" }: { className?: string }) {
  return (
    <span className={`font-display leading-none ${className}`}>
      Splyce<span className="text-accent">.</span>
    </span>
  );
}
