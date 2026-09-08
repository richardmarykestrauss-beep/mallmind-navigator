import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { ShieldAlert, Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AdminGuardProps {
  children: ReactNode;
}

/**
 * Wraps admin pages with three protection layers:
 *  1. Loading  — auth state not yet resolved (spinner)
 *  2. Unauthenticated — no session (sign-in prompt)
 *  3. Not admin — authenticated but is_admin = false (access denied)
 *  4. Admin — renders children
 */
export default function AdminGuard({ children }: AdminGuardProps) {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  // ── 1. Resolving auth state ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── 2. Not signed in ───────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
        <LogIn className="h-12 w-12 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold">Sign in required</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You must be signed in to access the admin panel.
          </p>
        </div>
        <Button onClick={() => navigate("/auth")}>Go to Sign In</Button>
      </div>
    );
  }

  // ── 3. Signed in but not admin ─────────────────────────────────────────────
  // Profile may still be loading (null) — treat null as not-admin to avoid flicker.
  if (!profile?.is_admin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
        <ShieldAlert className="h-12 w-12 text-destructive" />
        <div>
          <h1 className="text-xl font-semibold">Access denied</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your account does not have admin privileges.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/")}>
          Back to App
        </Button>
      </div>
    );
  }

  // ── 4. Admin — render the page ─────────────────────────────────────────────
  return <>{children}</>;
}
