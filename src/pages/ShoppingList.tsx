import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ShoppingBag, Sparkles, ListChecks, Loader2 } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { supabase, type ShoppingListItem } from "@/lib/supabaseClient";
import { toast } from "@/hooks/use-toast";

const ShoppingList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("shopping_list_items")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error) setItems((data ?? []) as ShoppingListItem[]);
      setLoading(false);
    };
    load();
  }, []);

  const add = async () => {
    if (!input.trim() || saving) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("shopping_list_items")
      .insert({ name: input.trim() })
      .select()
      .single();
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't add item", description: error.message });
      return;
    }
    setItems((prev) => [data as ShoppingListItem, ...prev]);
    setInput("");
  };

  return (
    <MobileShell>
      <ScreenHeader
        title="My Shopping List"
        subtitle={`${items.length} item${items.length === 1 ? "" : "s"} saved`}
        back={false}
      />

      {/* Add input */}
      <div className="px-5 animate-fade-in">
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-1.5 focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_hsl(190_100%_50%/0.15)] transition-all">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add an item..."
            className="flex-1 h-10 px-3 bg-transparent text-sm focus:outline-none"
          />
          <button
            onClick={add}
            disabled={saving}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground glow-primary hover:scale-105 active:scale-95 transition-transform disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" strokeWidth={2.8} />}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="px-5 mt-5 space-y-2.5">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 animate-fade-in">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl border border-dashed border-primary/40 bg-primary/5">
              <ListChecks className="h-9 w-9 text-primary" />
            </div>
            <p className="text-muted-foreground text-sm">Add items to start saving</p>
          </div>
        ) : (
          items.map((item, i) => (
            <div
              key={item.id ?? i}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface/70 backdrop-blur p-3.5 animate-slide-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
                <ShoppingBag className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{item.name}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* CTA */}
      {items.length > 0 && (
        <div className="px-5 mt-6">
          <Button
            variant="neonGreen"
            size="lg"
            className="w-full animate-pulse-glow-green"
            onClick={() => navigate("/deals")}
          >
            <Sparkles className="h-5 w-5" />
            Find Best Deals
          </Button>
        </div>
      )}
    </MobileShell>
  );
};

export default ShoppingList;
