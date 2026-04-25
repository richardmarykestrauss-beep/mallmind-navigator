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
        {/* Status-bar-like accent gradient */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-primary/10 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-secondary/5 to-transparent" />

        <div className={`relative h-full overflow-y-auto scrollbar-hide ${hideNav ? "pb-6" : "pb-28"}`}>
          {children}
        </div>

        {!hideNav && <BottomNav />}
      </div>
    </div>
  );
};

export default MobileShell;
