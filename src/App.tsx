import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Malls from "./pages/Malls.tsx";
import ShoppingList from "./pages/ShoppingList.tsx";
import Deals from "./pages/Deals.tsx";
import NavigateScreen from "./pages/NavigateScreen.tsx";
import Parking from "./pages/Parking.tsx";
import Rewards from "./pages/Rewards.tsx";
import Profile from "./pages/Profile.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/malls" element={<Malls />} />
          <Route path="/list" element={<ShoppingList />} />
          <Route path="/deals" element={<Deals />} />
          <Route path="/navigate" element={<NavigateScreen />} />
          <Route path="/parking" element={<Parking />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/profile" element={<Profile />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
