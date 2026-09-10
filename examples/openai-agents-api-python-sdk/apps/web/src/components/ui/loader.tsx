import * as React from "react";

import { cn } from "@/lib/utils";

// E2B terminal loader (ui.e2b.dev/loader), rewritten from styled-components to
// Tailwind — the spinning |/-\ glyph itself lives in the `terminal-spinner`
// utility in styles.css (animated `content` can't be expressed inline).
const sizeClasses = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
  xl: "text-2xl",
} as const;

interface LoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: keyof typeof sizeClasses;
}

const Loader = React.forwardRef<HTMLDivElement, LoaderProps>(
  ({ className, size = "md", ...props }, ref) => (
    <div
      className={cn(
        "inline-flex select-none items-center justify-center font-mono",
        sizeClasses[size],
        className
      )}
      ref={ref}
      {...props}
    >
      <span className="terminal-spinner" />
    </div>
  )
);
Loader.displayName = "Loader";

export { Loader };
