import { createClient } from "@supabase/supabase-js";

// Server client (uses service role key — never expose to browser).
// All DB operations go through this client via API routes.
export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

export type CollectionName = "pim_literature" | "pima_reports" | "wbg_pers";

export const COLLECTIONS: {
  id: CollectionName;
  label: string;
  matchFn: string;
  description: string;
}[] = [
  {
    id: "pim_literature",
    label: "Global PIM Good Practices",
    matchFn: "match_pim_literature",
    description:
      "World Bank, IMF, EC, EIB, and JICA guidance on Public Investment Management best practices.",
  },
  {
    id: "pima_reports",
    label: "IMF PIMA Reports",
    matchFn: "match_pima_reports",
    description:
      "IMF Public Investment Management Assessment reports for various countries.",
  },
  {
    id: "wbg_pers",
    label: "World Bank Public Finance Reviews",
    matchFn: "match_wbg_pers",
    description:
      "World Bank Public Expenditure Reviews (PERs) and Public Finance Reviews (PFRs) spanning 2015–2026.",
  },
];
