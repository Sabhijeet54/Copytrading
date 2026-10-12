import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/10 text-primary',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      success: 'border-transparent bg-success/12 text-success',
      warning: 'border-transparent bg-warning/18 text-[color-mix(in_oklch,var(--warning)_55%,var(--foreground))]',
      destructive: 'border-transparent bg-destructive/12 text-destructive',
      outline: 'text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
