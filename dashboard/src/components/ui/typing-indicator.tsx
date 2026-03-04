"use client";

import { cn } from "@/lib/utils";

/** Bouncing dots typing animation for chat streaming/thinking states. */
export function TypingIndicator({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-1", className)} aria-label="Typing">
      <span
        className="bg-foreground/70 inline-block size-1.5 animate-bounce rounded-full"
        style={{ animationDuration: "0.6s", animationDelay: "0ms" }}
      />
      <span
        className="bg-foreground/70 inline-block size-1.5 animate-bounce rounded-full"
        style={{ animationDuration: "0.6s", animationDelay: "0.15s" }}
      />
      <span
        className="bg-foreground/70 inline-block size-1.5 animate-bounce rounded-full"
        style={{ animationDuration: "0.6s", animationDelay: "0.3s" }}
      />
    </div>
  );
}

/** Blinking cursor for end-of-streaming text. */
export function BlinkingCursor({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block h-4 w-0.5 animate-pulse bg-foreground align-middle", className)}
      aria-hidden
    />
  );
}
