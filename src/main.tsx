import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./lib/history-navigation-guard";

createRoot(document.getElementById("root")!).render(<App />);
