import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installApiFetchBase } from "./lib/install-api-fetch-base";

installApiFetchBase();

createRoot(document.getElementById("root")!).render(<App />);
