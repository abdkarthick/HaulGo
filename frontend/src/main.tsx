import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// PERF FIX: StrictMode ah thookiten - Dev la double render aagum, Production la kooda extra work
// StrictMode illana TBT koraiyum, Long Tasks koraiyum
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);