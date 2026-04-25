import { MapPin, ShoppingBag } from "lucide-react";

interface LogoProps {
  size?: "sm" | "lg";
}

const Logo = ({ size = "sm" }: LogoProps) => {
  const isLg = size === "lg";
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`relative flex items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground glow-primary ${
          isLg ? "h-14 w-14" : "h-10 w-10"
        }`}
      >
        <MapPin className={isLg ? "h-7 w-7 absolute" : "h-5 w-5 absolute"} strokeWidth={2.5} />
        <ShoppingBag
          className={`${isLg ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} absolute -bottom-0.5 -right-0.5 text-secondary drop-shadow-[0_0_8px_hsl(var(--secondary))]`}
          fill="currentColor"
        />
      </div>
      <div className="flex flex-col leading-none">
        <span
          className={`font-display font-bold tracking-tight ${
            isLg ? "text-3xl" : "text-xl"
          }`}
        >
          Mall<span className="text-primary text-glow-primary">Mind</span>
        </span>
        {isLg && (
          <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mt-1">
            Smart Mall Companion
          </span>
        )}
      </div>
    </div>
  );
};

export default Logo;
