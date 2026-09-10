import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center cursor-pointer justify-center whitespace-nowrap !text-body-highlight",
    "transition-colors [&_svg]:transition-colors disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0",
    "[&_svg]:text-icon-tertiary",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: [
          "[&_svg]:text-icon-inverted",
          "bg-bg-inverted text-fg-inverted",
          "enabled:hover:bg-bg-inverted-hover", // hover
          "data-[display-state=hover]:bg-bg-inverted-hover", // duplicated hover, for display purposes
          "disabled:text-fg-tertiary disabled:bg-fill disabled:[&_svg]:text-icon-tertiary", // disabled
          "data-[state=open]:bg-bg-inverted-hover"
        ].join(" "),
        secondary: [
          "border",
          "enabled:hover:border-stroke-active", // hover
          "data-[display-state=hover]:border-stroke-active", // duplicated hover, for display purposes
          "enabled:active:bg-bg-1 enabled:active:[&_svg]:text-icon", // active
          "data-[display-state=active]:bg-bg-1 data-[display-state=active]:[&_svg]:text-icon", // duplicated active, for display purposes
          "disabled:opacity-65", // disabled
          "data-[state=open]:bg-bg-1"
        ].join(" "),
        tertiary: [
          "text-fg",
          "enabled:hover:text-fg enabled:hover:underline", // hover
          "data-[display-state=hover]:text-fg data-[display-state=hover]:underline", // duplicated hover, for display purposes
          "enabled:active:text-fg enabled:active:[&_svg]:text-icon", // active
          "data-[display-state=active]:text-fg data-[display-state=active]:[&_svg]:text-icon", // duplicated active, for display purposes
          "disabled:opacity-65 text-fg-tertiary", // disabled
        ].join(" "),
        quaternary: [
          "text-fg-tertiary",
          "enabled:hover:text-fg", // hover
          "data-[display-state=hover]:text-fg", // duplicated hover, for display purposes
          "enabled:active:text-fg enabled:active:[&_svg]:text-icon", // active
          "data-[display-state=active]:text-fg data-[display-state=active]:[&_svg]:text-icon", // duplicated active, for display purposes
          "disabled:opacity-65", // disabled
        ].join(" ")
      },
      size: {
        default:
          "[&_svg]:size-4 h-9 py-1.5 gap-1 [&:has(svg)]:pr-3 [&:has(svg)]:pl-2.5 px-4",
        sm: "h-7 w-7 px-2 py-1 [&_svg]:size-3",
        xs: "h-4.5 px-1.25 [&_svg]:size-3",
        icon: "h-9 w-9 px-2.5 py-1.5 [&_svg]:size-5",
        "icon-sm": "h-7 w-7 px-2.5 py-1.5 [&_svg]:size-4",
        "icon-xs": "size-4.5 [&_svg]:size-3",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
