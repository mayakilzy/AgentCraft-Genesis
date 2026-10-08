"use client";

import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Toaster — shadcn/ui-compatible toast viewport (sonner-backed).
 *
 * Wraps the sonner <Toaster> to apply the Calm Enterprise palette tokens.
 * Used by the G7 product experience for any non-blocking notification
 * (e.g., "Replay session saved", "Mission cancelled").
 *
 * The `Toaster` is rendered once in the root layout (web/src/app/layout.tsx).
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
