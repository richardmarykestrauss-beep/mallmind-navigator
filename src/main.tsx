import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./lib/serviceWorker";

// Register early so the first visit's assets go through the worker and are precached.
registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);
