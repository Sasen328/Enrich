import { createRoot } from "react-dom/client";
import { setAuthToken } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// Wire the bearer token used by the generated API client. The backend
// requires it when API_TOKEN is set there; in local dev VITE_API_TOKEN
// is typically unset and the backend allows unauthenticated calls.
const token = import.meta.env.VITE_API_TOKEN as string | undefined;
if (token) setAuthToken(token);

createRoot(document.getElementById("root")!).render(<App />);
