import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  [
    "inline-flex items-center justify-center gap-0.5 h-4.5 px-1 w-fit",
    "!text-label uppercase cursor-default whitespace-nowrap shrink-0 overflow-hidden",
    "[&>svg]:size-3 [&>svg]:pointer-events-none ![&>svg]:pl-0.75",
    "focus-visible:ring-1",
    "aria-invalid:ring-accent-error-highlight/20 aria-invalid:border-accent-error-highlight",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-fill hover:ring-1 ring-fg-secondary text-fg-secondary",
        defaultMuted: "bg-bg-highlight hover:ring-1 ring-fg-secondary text-fg-tertiary",
        positive:
          "bg-accent-positive-bg hover:ring-1 ring-accent-positive-highlight text-accent-positive-highlight",
        warning:
          "bg-accent-warning-bg hover:ring-1 ring-accent-warning-highlight text-accent-warning-highlight",
        info: "bg-accent-info-bg hover:ring-1 ring-accent-info-highlight text-accent-info-highlight",
        error:
          "bg-accent-error-bg hover:ring-1 ring-accent-error-highlight text-accent-error-highlight",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

function Badge({ className, variant, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
