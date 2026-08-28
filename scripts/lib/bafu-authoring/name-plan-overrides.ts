import type { BafuNamePlan } from "./name-plan-contract.ts";
import { textFromMultilang } from "./name-plan-text.ts";

export function splitBafuWasteDisposalName(baseName: unknown): BafuNamePlan | null {
  const text = textFromMultilang(baseName).trim();
  const match = /^(?<core>.+?),\s*(?<treatment>as building waste)$/iu.exec(text);
  if (!match?.groups?.core || !match?.groups?.treatment) return null;
  return {
    source: text,
    base_name: match.groups.core.trim(),
    treatment: match.groups.treatment.trim(),
  };
}

const exactNameSplitOverrides: Readonly<
  Record<string, { base_name: string; treatment: string; mix_location?: string }>
> = Object.freeze({
  "Fireproofed jute fibers, recycled": {
    base_name: "Fireproofed jute fibers",
    treatment: "recycled",
  },
  "Jute fibers, recycled": { base_name: "Jute fibers", treatment: "recycled" },
  "Rectangular straw bale, baling and loading bales": {
    base_name: "Rectangular straw bale",
    treatment: "baling and loading bales",
  },
  "Rectangular straw bale, straw cultivation": {
    base_name: "Rectangular straw bale",
    treatment: "straw cultivation",
  },
  "Rammed earth wall, earth extraction": {
    base_name: "Rammed earth wall",
    treatment: "earth extraction",
  },
  "Wheat grains conventional, Barrois, at farm": {
    base_name: "Wheat grains conventional, Barrois",
    treatment: "at farm",
  },
  "Barley grains conventional, Barrois, at farm": {
    base_name: "Barley grains conventional, Barrois",
    treatment: "at farm",
  },
  "Tap water, desalinated sea water, at user": {
    base_name: "Tap water, desalinated sea water",
    treatment: "at user",
  },
  "Production, washing machine, V-ZUG": {
    base_name: "washing machine, V-ZUG",
    treatment: "Production",
  },
  "Assembly, LCD screen": {
    base_name: "LCD screen",
    treatment: "Assembly",
  },
});

export function splitBafuExactNameOverride(text: string): BafuNamePlan | null {
  if (!Object.prototype.hasOwnProperty.call(exactNameSplitOverrides, text)) return null;
  const override = exactNameSplitOverrides[text];
  return {
    source: text,
    base_name: override.base_name,
    treatment: override.treatment,
    ...(override.mix_location === undefined ? {} : { mix_location: override.mix_location }),
  };
}
