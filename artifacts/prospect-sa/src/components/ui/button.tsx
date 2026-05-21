import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-280 ease-[cubic-bezier(0.16,1,0.30,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ac))]/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Filled lavender pill
        default:
           "bg-[hsl(var(--ac))] text-white border border-[hsl(var(--ac))] hover:shadow-[0_6px_20px_hsl(var(--glow)/0.40)] hover:-translate-y-0.5",
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive hover:shadow-[0_6px_20px_hsl(var(--destructive)/0.30)]",
        // Outline / ghost — transparent with lavender border
        outline:
          "border border-[hsl(var(--ac))] text-[hsl(var(--ac))] bg-transparent hover:bg-[hsl(var(--ac))]/10",
        // Ghost: outline-only feel, faded
        ghost:
          "border border-[hsl(var(--bd))] text-[hsl(var(--tx-m))] bg-transparent hover:bg-[hsl(var(--ac))]/8 hover:text-[hsl(var(--ac))] hover:border-[hsl(var(--ac))]",
        // Soft: light lavender wash
        soft:
          "bg-[hsl(var(--brand-mist))]/50 text-[hsl(var(--ac))] border border-[hsl(var(--brand-mist))] hover:bg-[hsl(var(--brand-mist))]/70 hover:shadow-[0_4px_14px_hsl(var(--glow)/0.20)]",
        secondary:
          "border bg-secondary text-secondary-foreground border-secondary",
        link: "text-primary underline-offset-4 hover:underline rounded-none",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
