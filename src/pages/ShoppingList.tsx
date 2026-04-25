import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Shirt, Apple, Smartphone, Home, Sparkles, Search, CheckCircle2, ListChecks } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";

type Status = "found" | "searching" | "not-found";

interface Item {
  id: number;
  name: string;
  category: "fashion" | "food" | "tech" | "home";
  status: Status;
}

const catIcon = {
  fashion: Shirt,
  food: Apple,
  tech: Smartphone,
  home: Home,
};

const statusMeta: Record<Status, { label: string; color: string; Icon: any }> = {
  found: { label: "Found Best Deal", color: "text-secondary border-secondary/40 bg-secondary/10", Icon: CheckCircle2 },
  searching: { label: "Searching...", color: "text-primary border-primary/40 bg-primary/10", Icon: Search },
  "not-found": { label: "Not Found", color: "text-muted-foreground border-border bg-muted", Icon: Sparkles },
};

const initial: Item[] = [
  { id: 1, name: "Nike Air Max", category: "fashion", status: "found" },
  { id: 2, name: "iPhone 15 Case", category: "tech", status: "searching" },
  { id: 3, name: "Organic Coffee Beans", category: "food", status: "found" },
  { id: 4, name: "Scented Candle", category: "home", status: "not-found" },
];

const ShoppingList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>(initial);
  const [input, setInput] = useState("");

  const add = () => {
    if (!input.trim()) return;
    setItems((prev) => [
      ...prev,
      { id: Date.now(), name: input, category: "fashion", status: "searching" },
    ]);
    setInput("");
  };

  return (
    <MobileShell>
      <ScreenHeader
        title="My Shopping List"
        subtitle={`${items.length} items · ${items.filter((i) => i.status === "found").length} deals locked in`}
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
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground glow-primary hover:scale-105 active:scale-95 transition-transform"
          >
            <Plus className="h-5 w-5" strokeWidth={2.8} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="px-5 mt-5 space-y-2.5">
        {items.length === 0 ? (
          <div className="text-center py-20 animate-fade-in">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl border border-dashed border-primary/40 bg-primary/5">
              <ListChecks className="h-9 w-9 text-primary" />
            </div>
            <p className="text-muted-foreground text-sm">Add items to start saving</p>
          </div>
        ) : (
          items.map((item, i) => {
            const Cat = catIcon[item.category];
            const { label, color, Icon } = statusMeta[item.status];
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface/70 backdrop-blur p-3.5 animate-slide-up"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
                  <Cat className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{item.name}</p>
                  <span className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${color}`}>
                    <Icon className="h-3 w-3" />
                    {label}
                  </span>
                </div>
              </div>
            );
          })
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
