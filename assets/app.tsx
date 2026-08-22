import { createRoot } from "react-dom/client";
import { AdminUsers } from "@/components/AdminUsers";
import { SearchExperience } from "@/components/SearchExperience";
import "@/styles/app.css";

const root = document.getElementById("app-root");

if (root) {
  createRoot(root).render(root.dataset.page === "admin" ? <AdminUsers /> : <SearchExperience />);
}
