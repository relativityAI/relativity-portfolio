import {
  LuFileText,
  LuScale,
  LuBuilding,
  LuMegaphone,
  LuMic,
  LuBadgeDollarSign,
  LuUsers,
  LuTarget,
  LuActivity,
  LuNewspaper,
  LuNetwork,
  LuShieldCheck,
} from "react-icons/lu";

export type DataSource = {
  icon: typeof LuFileText;
  label: string;
};

export const SOURCES: DataSource[] = [
  { icon: LuFileText, label: "Financial statements" },
  { icon: LuScale, label: "Ratios & metrics" },
  { icon: LuBuilding, label: "Shareholding patterns" },
  { icon: LuMegaphone, label: "Filings" },
  { icon: LuMic, label: "Earnings calls" },
  { icon: LuBadgeDollarSign, label: "Corporate actions" },
  { icon: LuUsers, label: "Insider & block deals" },
  { icon: LuTarget, label: "Analyst estimates" },
  { icon: LuActivity, label: "Price & volume" },
  { icon: LuNewspaper, label: "News & sentiment" },
  { icon: LuNetwork, label: "Peer comparison" },
  { icon: LuShieldCheck, label: "Credit ratings" },
];
