import { CategoryClient } from "./category-client";
import { FileCategory } from "@/lib/utils";

// This is required for static export with dynamic routes
export function generateStaticParams() {
  // Return all possible category types
  return [
    { type: "software" },
    { type: "media" },
    { type: "documents" },
    { type: "archives" },
    { type: "other" }
  ];
}

export default function CategoryPage() {
  return <CategoryClient />;
}
