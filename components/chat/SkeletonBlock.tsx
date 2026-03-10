"use client";

export function SkeletonBlock({
  className,
}: Readonly<{
  className?: string;
}>) {
  return (
    <div
      className={`animate-pulse rounded-md bg-[hsl(var(--aui-border)/0.7)] ${className ?? ""}`}
    />
  );
}
