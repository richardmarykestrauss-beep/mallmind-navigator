import { ReactNode } from "react";
import BottomNav from "./BottomNav";

interface MobileShellProps {
  children: ReactNode;
  hideNav?: boolean;
}

const MobileShell = ({ children, hideNav }: MobileShellProps) => {
  return (
    <div className="min-h-screen w-full bg-background flex items-center justify-center md:p-6">
      {/* Decorative desktop backdrop */}
      <div className="pointer-events-none fixed inset-0 hidden md:block opacity-40 grid-bg" />

      <div className="relative w-full md:max-w-[420px] md:rounded-[2.5rem] md:border md:border-border md:shadow-[0_30px_80px_-20px_hsl(190_100%_50%/0.25)] overflow-hidden bg-background min-h-screen md:min-h-[860px] md:h-[860px]">
        {/* ── Ambient glow orbs — non-scrolling atmosphere ── */}
        {/* Cyan radial — top-right */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-primary/12 blur-[90px]" />
        {/* Violet radial — bottom-left */}
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-violet-600/8 blur-[90px]" />
        {/* Subtle secondary glow — bottom-right */}
        <div className="pointer-events-none absolute bottom-1/3 -right-12 h-48 w-48 rounded-full bg-secondary/6 blur-[70px]" />

        {/* Status-bar-like accent gradient */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-primary/10 to-transparent z-[1]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-secondary/5 to-transparent z-[1]" />

        <div className={`relative z-[2] h-full overflow-y-auto scrollbar-hide ${hideNav ? "pb-6" : "pb-28"}`}>
          {children}
        </div>

        {!hideNav && <BottomNav />}
      </div>
    </div>
  );
};

export default MobileShell;
