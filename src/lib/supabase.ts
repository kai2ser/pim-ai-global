import { createClient } from "@supabase/supabase-js";

// Browser client (uses anon key)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Server client (uses service role key — never expose to browser)
export function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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
