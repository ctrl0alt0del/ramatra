"use client";

import { ScanText } from "lucide-react";

export function ContextCompactionInline({
  text,
}: Readonly<{
  text: string;
}>) {
  return (
    <div className="px-1 py-3 sm:px-2">
      <div className="flex items-center gap-3 text-[11px] text-[hsl(var(--aui-muted-foreground))]/85">
        <div className="h-px flex-1 bg-[linear-gradient(90deg,transparent,rgba(126,113,255,0.35),rgba(126,113,255,0.15))]" />
        <div className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5">
          <ScanText className="h-3.5 w-3.5 text-[#7e71ff]/90" />
          <span className="font-medium tracking-[0.01em]">{text}</span>
        </div>
        <div className="h-px flex-1 bg-[linear-gradient(90deg,rgba(126,113,255,0.15),rgba(126,113,255,0.35),transparent)]" />
      </div>
    </div>
  );
}
