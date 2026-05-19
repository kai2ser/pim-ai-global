import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";

// Server client (uses service role key — never expose to browser).
// All DB operations go through this client via API routes.
export function getServiceClient() {
  const env = getServerEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

export type CollectionName =
  | "pim_literature"
  | "pima_reports"
  | "wbg_pers"
  | "pefa_reports";

export interface CollectionDef {
  id: CollectionName;
  label: string;
  matchFn: string;
  statsFn: string;
  description: string;
  /**
   * Domain hint used by /api/query to pick the right system prompt
   * (PEFA needs an indicator-aware prompt; the other three share the
   * Public Investment Management baseline).
   */
  domain: "pim" | "pefa";
}

export const COLLECTIONS: CollectionDef[] = [
  {
    id: "pim_literature",
    label: "Global PIM Good Practices",
    matchFn: "match_pim_literature",
    statsFn: "stats_pim_literature",
    description:
      "World Bank, IMF, EC, EIB, and JICA guidance on Public Investment Management best practices.",
    domain: "pim",
  },
  {
    id: "pima_reports",
    label: "IMF PIMA Reports",
    matchFn: "match_pima_reports",
    statsFn: "stats_pima_reports",
    description:
      "IMF Public Investment Management Assessment reports for various countries.",
    domain: "pim",
  },
  {
    id: "wbg_pers",
    label: "World Bank Public Finance Reviews",
    matchFn: "match_wbg_pers",
    statsFn: "stats_wbg_pers",
    description:
      "World Bank Public Expenditure Reviews (PERs) and Public Finance Reviews (PFRs) spanning 2015–2026.",
    domain: "pim",
  },
  {
    id: "pefa_reports",
    label: "PEFA National Reports",
    matchFn: "match_pefa_reports",
    statsFn: "stats_pefa_reports",
    description:
      "Public Expenditure and Financial Accountability assessments — final, publicly available country-level reports from the PEFA Secretariat.",
    domain: "pefa",
  },
];
