/**
 * PriceAlertButton
 * Bell icon on a product card. Tap once to pin — tap again to unpin.
 * Handles permission request inline.
 */

import { useState, useEffect } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

interface Props {
  productId: string;
  className?: string;
}

export default function PriceAlertButton({ productId, className }: Props) {
  const { user } = useAuth();
  const { supported, addAlert, removeAlert, hasAlert } = usePushNotifications();
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true); // checking initial state

  // Load initial state
  useEffect(() => {
    if (!user) { setLoading(false); return; }
    hasAlert(productId).then((v) => {
      setActive(v);
      setLoading(false);
    });
  }, [user, productId, hasAlert]);

  // Don't render if push isn't supported or user isn't logged in
  if (!supported || !user) return null;

  async function toggle() {
    setLoading(true);
    try {
      if (active) {
        await removeAlert(productId);
        setActive(false);
      } else {
        const ok = await addAlert(productId);
        if (ok) setActive(true);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); toggle(); }}
      title={active ? "Remove price alert" : "Alert me when price drops"}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-xl border transition-all",
        active
          ? "border-secondary/50 bg-secondary/15 text-secondary"
          : "border-border bg-surface/60 text-muted-foreground hover:text-foreground hover:border-secondary/40",
        className
      )}
    >
      {loading
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : active
        ? <Bell className="h-3.5 w-3.5 fill-secondary" />
        : <Bell className="h-3.5 w-3.5" />
      }
    </button>
  );
}
