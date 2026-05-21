import { clsx } from "clsx";
import { HTMLAttributes, forwardRef } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ hover = false, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={clsx(
        "rounded-xl border bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800",
        hover && "transition-shadow hover:shadow-lg hover:border-zinc-300 dark:hover:border-zinc-700",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);
Card.displayName = "Card";
