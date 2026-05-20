/**
 * usePushNotifications
 *
 * Manages the full Web Push lifecycle:
 *  1. Check / request notification permission
 *  2. Subscribe the browser to our VAPID public key
 *  3. Save the subscription to push_subscriptions table
 *  4. Expose helpers to add / remove price alerts
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { VAPID_PUBLIC_KEY } from "@/lib/env";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export type AlertStatus = "idle" | "loading" | "active" | "error";

export function usePushNotifications() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [supported] = useState(
    () => typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window
  );

  useEffect(() => {
    if (supported) setPermission(Notification.permission);
  }, [supported]);

  /** Request permission + create browser push subscription + save to DB */
  const subscribe = useCallback(async (): Promise<PushSubscription | null> => {
    if (!supported || !user) return null;

    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm !== "granted") return null;

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    // Persist to Supabase (upsert — safe to call multiple times)
    const subJson = sub.toJSON();
    await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: subJson.endpoint!,
        p256dh: subJson.keys!.p256dh,
        auth_key: subJson.keys!.auth,
      },
      { onConflict: "user_id,endpoint" }
    );

    return sub;
  }, [supported, user]);

  /** Add a price alert. Subscribes to push first if needed. */
  const addAlert = useCallback(
    async (productId: string, targetPrice?: number): Promise<boolean> => {
      if (!user) return false;

      // Ensure we have a push subscription
      if (permission !== "granted") {
        const sub = await subscribe();
        if (!sub) return false;
      }

      const { error } = await supabase.from("price_alerts").upsert(
        {
          user_id: user.id,
          product_id: productId,
          target_price: targetPrice ?? null,
        },
        { onConflict: "user_id,product_id" }
      );

      return !error;
    },
    [user, permission, subscribe]
  );

  /** Remove a price alert */
  const removeAlert = useCallback(
    async (productId: string): Promise<boolean> => {
      if (!user) return false;
      const { error } = await supabase
        .from("price_alerts")
        .delete()
        .eq("user_id", user.id)
        .eq("product_id", productId);
      return !error;
    },
    [user]
  );

  /** Check if user has an alert for a given product */
  const hasAlert = useCallback(
    async (productId: string): Promise<boolean> => {
      if (!user) return false;
      const { data } = await supabase
        .from("price_alerts")
        .select("id")
        .eq("user_id", user.id)
        .eq("product_id", productId)
        .limit(1);
      return (data?.length ?? 0) > 0;
    },
    [user]
  );

  return { supported, permission, subscribe, addAlert, removeAlert, hasAlert };
}
