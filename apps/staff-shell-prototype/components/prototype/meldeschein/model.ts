// PROTOTYPE model. In memory only. Rules from docs/research/dach-compliance.md.
export type Path = "AT_SIGN" | "DE_PRINT" | "DE_CARD";

export const PATHS: Record<Path, { key: string; name: string; country: "AT" | "DE"; property: string; rule: string }> = {
  AT_SIGN: { key: "A", name: "Austria: sign on tablet", country: "AT", property: "Haus am Ring, Wien", rule: "All guests register. Signature on tablet is valid (MeldeV §19)." },
  DE_PRINT: { key: "B", name: "Germany: print, sign by hand", country: "DE", property: "Hotel Isartor, München", rule: "Foreign guests only. Tablet collects data, signature must be handwritten on paper (BMG §29(2))." },
  DE_CARD: { key: "C", name: "Germany: card payment confirms", country: "DE", property: "Hotel Isartor, München", rule: "Foreign guests only. Card payment with SCA on arrival day replaces the signature (BMG §29(5) Nr. 1)." },
};

export type Guest = {
  id: string; first: string; last: string; dob: string; nationality: string; relation: "primary" | "spouse" | "child" | "other";
  street: string; postcode: string; city: string; country: string; passport: string; gender: string;
};

export const GUESTS: Guest[] = [
  { id: "g1", first: "Aiko", last: "Tanaka", dob: "1988-04-12", nationality: "JP", relation: "primary", street: "2-1 Marunouchi", postcode: "100-0005", city: "Tokyo", country: "Japan", passport: "TR4821193", gender: "" },
  { id: "g2", first: "Kenji", last: "Tanaka", dob: "1986-11-02", nationality: "JP", relation: "spouse", street: "2-1 Marunouchi", postcode: "100-0005", city: "Tokyo", country: "Japan", passport: "TR5530127", gender: "" },
  { id: "g3", first: "Mio", last: "Tanaka", dob: "2020-06-21", nationality: "JP", relation: "child", street: "2-1 Marunouchi", postcode: "100-0005", city: "Tokyo", country: "Japan", passport: "TR7710045", gender: "" },
  { id: "g4", first: "Lukas", last: "Brandt", dob: "1990-02-14", nationality: "DE", relation: "other", street: "Lindenstr. 8", postcode: "50674", city: "Köln", country: "Germany", passport: "", gender: "" },
  { id: "g5", first: "Camille", last: "Durand", dob: "1991-09-30", nationality: "FR", relation: "other", street: "14 Rue Oberkampf", postcode: "75011", city: "Paris", country: "France", passport: "19AF40211", gender: "" },
];

// Who needs their own form, who is only counted, who needs nothing.
export type Duty = "own-form" | "counted" | "none";
export function duty(g: Guest, path: Path): Duty {
  if (PATHS[path].country === "AT") return g.relation === "child" ? "counted" : "own-form"; // PROTOTYPE assumption: minors listed on a parent's form
  if (g.nationality === "DE") return "none"; // since 1 Jan 2025
  if (g.relation === "spouse" || g.relation === "child") return "counted"; // count only, no names
  return "own-form";
}

export type Step = "idle" | "welcome" | "details" | "companions" | "review" | "sign" | "handoff" | "card" | "done";

export type FormState = {
  guestId: string;
  step: Step;
  data: Guest;
  consent: boolean;
  signature: string | null;      // AT only: data URL
  idChecked: boolean;            // operator compared form with passport
  idNote: string;
  printed: boolean;              // DE_PRINT
  signedOnPaper: boolean;        // DE_PRINT
  cardToken: string | null;      // DE_CARD: purpose-bound number of the payment instrument
  completedAt: string | null;
};

export const DEVICES = [
  { id: "d1", name: "Lobby iPad 1", online: true },
  { id: "d2", name: "Lobby iPad 2", online: true },
  { id: "d3", name: "Back office iPad", online: false },
];
