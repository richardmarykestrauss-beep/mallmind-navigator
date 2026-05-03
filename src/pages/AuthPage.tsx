import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import Logo from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const AuthPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();

  const from = (location.state as { from?: string })?.from ?? "/";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (mode === "signin") {
        const { error: err } = await signInWithEmail(email.trim(), password);
        if (err) { setError(err); return; }
        navigate(from, { replace: true });
      } else {
        const { error: err } = await signUpWithEmail(email.trim(), password);
        if (err) { setError(err); return; }
        setSuccess("Check your email to confirm your account, then sign in.");
        setMode("signin");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    await signInWithGoogle();
    // Page will redirect — no need to reset loading
  }

  return (
    <MobileShell>
      <div className="flex flex-col min-h-full px-6 pt-12 pb-8 animate-fade-in">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-10">
          <Logo />
          <p className="text-sm text-muted-foreground text-center max-w-[240px] leading-relaxed">
            {mode === "signin"
              ? "Welcome back. Sign in to access your rewards, alerts, and saved routes."
              : "Create a free account to unlock rewards, price alerts, and personalized routes."
            }
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-2xl border border-border bg-surface/60 p-1 mb-6">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); setSuccess(null); }}
              className={cn(
                "flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all",
                mode === m
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m === "signin" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        {/* Error / success */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary mb-4">
            {success}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Email */}
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoComplete="email"
              className="w-full h-12 pl-11 pr-4 rounded-2xl border border-border bg-surface text-sm focus:outline-none focus:border-primary/50 focus:shadow-[0_0_0_3px_hsl(190_100%_50%/0.15)] transition-all"
            />
          </div>

          {/* Password */}
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "Choose a password (8+ chars)" : "Your password"}
              required
              minLength={mode === "signup" ? 8 : undefined}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              className="w-full h-12 pl-11 pr-12 rounded-2xl border border-border bg-surface text-sm focus:outline-none focus:border-primary/50 focus:shadow-[0_0_0_3px_hsl(190_100%_50%/0.15)] transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword((p) => !p)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <Button
            type="submit"
            variant="neon"
            size="lg"
            className="w-full"
            disabled={loading || !email.trim() || !password.trim()}
          >
            {loading
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : mode === "signin" ? "Sign In" : "Create Account"
            }
          </Button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Google OAuth */}
        <Button
          variant="glass"
          size="lg"
          className="w-full"
          onClick={handleGoogle}
          disabled={googleLoading}
        >
          {googleLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
          )}
          Continue with Google
        </Button>

        {/* Skip */}
        <button
          onClick={() => navigate("/")}
          className="mt-6 text-xs text-muted-foreground hover:text-foreground transition-colors text-center w-full"
        >
          Continue without account
        </button>

        {/* Legal */}
        <p className="mt-4 text-[10px] text-muted-foreground/60 text-center leading-relaxed">
          By signing up you agree to our Terms of Service and Privacy Policy.
          Your data stays in South Africa.
        </p>
      </div>
    </MobileShell>
  );
};

export default AuthPage;
