import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
}

const ScreenHeader = ({ title, subtitle, back = true, right }: ScreenHeaderProps) => {
  const navigate = useNavigate();
  return (
    <div className="flex items-start justify-between px-5 pt-6 pb-4 animate-fade-in">
      <div className="flex items-start gap-3">
        {back && (
          <button
            onClick={() => navigate(-1)}
            className="mt-1 flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface/60 backdrop-blur hover:border-primary/50 transition-colors"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <div>
          <h1 className="font-display text-2xl font-bold leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
};

export default ScreenHeader;
