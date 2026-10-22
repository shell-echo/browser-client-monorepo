"use client"

import type { ComponentProps } from "react"
import type { VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"
import { buttonVariants } from "./button"

// Navigation stays a native link while sharing the preset's button styling.
export function ButtonLink({ className, variant, size, ...props }: ComponentProps<"a"> & VariantProps<typeof buttonVariants>) {
  return <a data-slot="button-link" className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
