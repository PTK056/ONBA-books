/** The Splyce wordmark: Gloock, with the gold dot from the landing page. */
export function Logo({ className = "text-2xl" }: { className?: string }) {
  return (
    <span className={`font-display leading-none ${className}`}>
      Splyce<span className="text-accent">.</span>
    </span>
  );
}
