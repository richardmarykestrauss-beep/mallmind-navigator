import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ShoppingSessionProvider } from "@/context/ShoppingSessionContext";
import { LocationProvider } from "@/context/LocationContext";
import { AuthProvider } from "@/context/AuthContext";

// Eagerly load the shell + first screen (no flash)
import Index from "./pages/Index.tsx";

// Lazy-load all other pages (code-split per route)
const Malls         = lazy(() => import("./pages/Malls.tsx"));
const SearchPage    = lazy(() => import("./pages/SearchPage.tsx"));
const ShoppingList  = lazy(() => import("./pages/ShoppingList.tsx"));
const Deals         = lazy(() => import("./pages/Deals.tsx"));
const NavigateScreen= lazy(() => import("./pages/NavigateScreen.tsx"));
const Parking       = lazy(() => import("./pages/Parking.tsx"));
const Rewards       = lazy(() => import("./pages/Rewards.tsx"));
const Profile       = lazy(() => import("./pages/Profile.tsx"));
const AssistantPage = lazy(() => import("./pages/AssistantPage.tsx"));
const AuthPage      = lazy(() => import("./pages/AuthPage.tsx"));
const NotFound      = lazy(() => import("./pages/NotFound.tsx"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
      <ShoppingSessionProvider>
        <LocationProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/malls" element={<Malls />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/list" element={<ShoppingList />} />
                <Route path="/deals" element={<Deals />} />
                <Route path="/assistant" element={<AssistantPage />} />
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/navigate" element={<NavigateScreen />} />
                <Route path="/parking" element={<Parking />} />
                <Route path="/rewards" element={<Rewards />} />
                <Route path="/profile" element={<Profile />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </LocationProvider>
      </ShoppingSessionProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
