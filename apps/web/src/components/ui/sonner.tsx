"use client";

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme === "light" || theme === "dark" ? theme : "system"}
      position="top-center"
      duration={4000}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-[18px] text-success" strokeWidth={1.75} />,
        info: <InfoIcon className="size-[18px] text-primary" strokeWidth={1.75} />,
        warning: <TriangleAlertIcon className="size-[18px] text-warning" strokeWidth={1.75} />,
        error: <OctagonXIcon className="size-[18px] text-destructive" strokeWidth={1.75} />,
        loading: <Loader2Icon className="size-[18px] animate-spin" strokeWidth={1.75} />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "material !rounded-2xl !bg-popover/75 !backdrop-blur-2xl !backdrop-saturate-[1.8] !shadow-lg !border-border/60 !text-[14px]",
          description: "!text-muted-foreground !text-[13px]",
          actionButton: "!rounded-full !bg-primary !text-primary-foreground !font-medium",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "16px",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
