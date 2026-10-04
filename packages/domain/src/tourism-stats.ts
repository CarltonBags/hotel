/**
 * Official tourism statistics (ticket 85, research "Tourism statistics
 * reporting duties"): one report per property and calendar month in the
 * country's variant, counting persons by country of residence, in the row
 * order of the official form. Germany: form HOT, section F. Austria: form
 * F-B1/2, Austria by federal state and Germany by region. Switzerland:
 * HESTA, each country by its ISO code.
 */

export type StatsVariant = "DE" | "AT" | "CH";

export function statsVariant(country: string): StatsVariant | null {
  return country === "DE" || country === "AT" || country === "CH" ? country : null;
}

export interface StatsRow {
  key: string;
  label: { de: string; en: string };
}

const row = (key: string, de: string, en = de): StatsRow => ({ key, label: { de, en } });

const EUROPE = "AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM TR UA VA XK".split(" ");
const AFRICA = "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW".split(" ");
const CENTRAL_AMERICA = "AG AI AW BB BL BQ BS BZ CR CU CW DM DO GD GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PR SV SX TC TT VC VG VI".split(" ");
const SOUTH_AMERICA = "AR BO BR CL CO EC FK GF GY PE PY SR UY VE".split(" ");
const NORTH_AMERICA = "BM CA GL PM US".split(" ");
const ASIA = "AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TW UZ VN YE".split(" ");
const OCEANIA = "AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV VU WF WS".split(" ");

/** Germany, form HOT section F: "Wohnsitz der Gäste (nicht Staatsangehörigkeit)", in the form's order. */
const DE_ROWS: StatsRow[] = [
  row("DE", "Deutschland", "Germany"),
  ...(
    [
      ["BE", "Belgien", "Belgium"], ["BG", "Bulgarien", "Bulgaria"], ["DK", "Dänemark", "Denmark"], ["EE", "Estland", "Estonia"], ["FI", "Finnland", "Finland"],
      ["FR", "Frankreich", "France"], ["GR", "Griechenland", "Greece"], ["GB", "Vereinigtes Königreich", "United Kingdom"], ["IE", "Irland", "Ireland"],
      ["IS", "Island", "Iceland"], ["IT", "Italien", "Italy"], ["HR", "Kroatien", "Croatia"], ["LV", "Lettland", "Latvia"], ["LT", "Litauen", "Lithuania"],
      ["LU", "Luxemburg", "Luxembourg"], ["MT", "Malta", "Malta"], ["NL", "Niederlande", "Netherlands"], ["NO", "Norwegen", "Norway"], ["AT", "Österreich", "Austria"],
      ["PL", "Polen", "Poland"], ["PT", "Portugal", "Portugal"], ["RO", "Rumänien", "Romania"], ["RU", "Russische Föderation", "Russia"], ["SE", "Schweden", "Sweden"],
      ["CH", "Schweiz (einschl. Liechtenstein)", "Switzerland (incl. Liechtenstein)"], ["SK", "Slowakei", "Slovakia"], ["SI", "Slowenien", "Slovenia"], ["ES", "Spanien", "Spain"],
      ["CZ", "Tschechien", "Czechia"], ["TR", "Türkei", "Türkiye"], ["UA", "Ukraine", "Ukraine"], ["HU", "Ungarn", "Hungary"], ["CY", "Zypern", "Cyprus"],
    ] as const
  ).map(([k, de, en]) => row(k, de, en)),
  row("other_europe", "Sonstiges Europa", "Other Europe"),
  row("ZA", "Südafrika", "South Africa"),
  row("other_africa", "Sonstiges Afrika", "Other Africa"),
  row("CA", "Kanada", "Canada"),
  row("US", "Vereinigte Staaten", "United States"),
  row("other_central_america", "Mittelamerika und Karibik", "Central America and Caribbean"),
  row("BR", "Brasilien", "Brazil"),
  row("other_south_america", "Sonstiges Südamerika", "Other South America"),
  row("other_north_america", "Sonstiges Nordamerika", "Other North America"),
  row("gulf", "Arabische Golfstaaten", "Arab Gulf states"),
  row("CN", "China (einschl. Hongkong)", "China (incl. Hong Kong)"),
  row("IN", "Indien", "India"),
  row("IL", "Israel", "Israel"),
  row("JP", "Japan", "Japan"),
  row("KR", "Südkorea", "South Korea"),
  row("TW", "Taiwan", "Taiwan"),
  row("other_asia", "Sonstiges Asien", "Other Asia"),
  row("AU", "Australien", "Australia"),
  row("NZ", "Neuseeland und Ozeanien", "New Zealand and Oceania"),
  row("unknown", "Ohne Angabe", "Not stated"),
];

const AT_STATES = [
  ["at_burgenland", "Burgenland"], ["at_kaernten", "Kärnten"], ["at_noe", "Niederösterreich"], ["at_ooe", "Oberösterreich"], ["at_salzburg", "Salzburg"],
  ["at_steiermark", "Steiermark"], ["at_tirol", "Tirol"], ["at_vorarlberg", "Vorarlberg"], ["at_wien", "Wien"],
] as const;
const DE_REGIONS = [
  ["de_bayern", "Bayern"], ["de_bw", "Baden-Württemberg"], ["de_nrw", "Nordrhein-Westfalen"], ["de_mitte", "Mitteldeutschland (Hessen, Rheinland-Pfalz, Saarland)"],
  ["de_nord", "Norddeutschland (Niedersachsen, Hamburg, Bremen, Schleswig-Holstein)"], ["de_ost", "Ostdeutschland (Sachsen, Sachsen-Anhalt, Thüringen, Brandenburg, Mecklenburg-Vorpommern)"],
  ["de_berlin", "Berlin"],
] as const;

/** Austria, form F-B1/2: Austrian federal states, German regions, then the other origins of the form. */
const AT_ROWS: StatsRow[] = [
  ...AT_STATES.map(([k, l]) => row(k, l)),
  row("at_unknown_state", "Österreich, Bundesland fehlt (Postleitzahl ergänzen)", "Austria, state missing (add the postal code)"),
  ...DE_REGIONS.map(([k, l]) => row(k, l)),
  row("de_unknown_region", "Deutschland, Region fehlt (Postleitzahl ergänzen)", "Germany, region missing (add the postal code)"),
  ...(
    [
      ["arab_asia", "Arabische Länder in Asien"], ["AU", "Australien"], ["BE", "Belgien"], ["BR", "Brasilien"], ["BG", "Bulgarien"], ["CN", "China (inkl. Hongkong, Macao)"],
      ["DK", "Dänemark"], ["EE", "Estland"], ["FI", "Finnland"], ["FR", "Frankreich (inkl. Monaco)"], ["GR", "Griechenland"], ["cis", "übrige GUS"], ["IN", "Indien"],
      ["IE", "Irland"], ["IS", "Island"], ["IL", "Israel"], ["IT", "Italien"], ["JP", "Japan"], ["se_europe", "restliches Südosteuropa"], ["CA", "Kanada"], ["HR", "Kroatien"],
      ["LV", "Lettland"], ["LT", "Litauen"], ["LU", "Luxemburg"], ["MT", "Malta"], ["NZ", "Neuseeland"], ["NL", "Niederlande"], ["NO", "Norwegen"], ["PL", "Polen"],
      ["PT", "Portugal"], ["RO", "Rumänien"], ["RU", "Russland"], ["SA", "Saudi-Arabien"], ["SE", "Schweden"], ["CH", "Schweiz und Liechtenstein"], ["SK", "Slowakei"],
      ["SI", "Slowenien"], ["ES", "Spanien"], ["ZA", "Südafrika"], ["KR", "Südkorea"], ["se_asia", "Südostasien"], ["TW", "Taiwan"], ["CZ", "Tschechische Republik"],
      ["TR", "Türkei"], ["UA", "Ukraine"], ["HU", "Ungarn"], ["US", "USA"], ["AE", "Vereinigte Arabische Emirate"], ["GB", "Vereinigtes Königreich"], ["CY", "Zypern"],
      ["other_africa", "Übriges Afrika"], ["other_asia", "Übriges Asien"], ["latin_america", "Zentral- und Südamerika"], ["other", "Übriges Ausland"],
    ] as const
  ).map(([k, l]) => row(k, l)),
  row("unknown", "Ohne Angabe", "Not stated"),
];

/** The rows of a variant's form, in the form's order. Switzerland reports each country by its ISO code (rows come from the guests). */
export function statsRows(variant: StatsVariant): StatsRow[] {
  return variant === "DE" ? DE_ROWS : variant === "AT" ? AT_ROWS : [row("unknown", "Ohne Angabe", "Not stated")];
}

/** Austrian federal state from an Austrian postal code (leading digits; border areas follow their postal region). */
function austrianState(postal: string): string | null {
  if (!/^\d{4}$/.test(postal)) return null;
  const p = Number(postal.slice(0, 2));
  if (p < 20) return "at_wien";
  if (p < 40) return "at_noe";
  // 52xx and 53xx (Braunau, Mattighofen) are Upper Austria
  if (p < 50 || p === 52 || p === 53) return "at_ooe";
  if (p < 60) return "at_salzburg";
  if (p < 67) return "at_tirol";
  if (p < 70) return "at_vorarlberg";
  if (p < 80) return "at_burgenland";
  if (p < 90) return "at_steiermark";
  // 99xx is East Tyrol
  return p === 99 ? "at_tirol" : "at_kaernten";
}

/** German postal regions (first two digits) to the German regions of form F-B1/2; border areas follow their postal region. */
const DE_POSTAL: Record<string, string> = {};
const region = (from: number, to: number, key: string) => {
  for (let p = from; p <= to; p++) DE_POSTAL[String(p).padStart(2, "0")] = key;
};
region(1, 9, "de_ost");
region(10, 13, "de_berlin");
region(14, 19, "de_ost");
region(20, 31, "de_nord");
region(32, 33, "de_nrw");
region(34, 36, "de_mitte");
region(37, 38, "de_nord");
region(39, 39, "de_ost");
region(40, 48, "de_nrw");
region(49, 49, "de_nord");
region(50, 53, "de_nrw");
region(54, 56, "de_mitte");
region(57, 59, "de_nrw");
region(60, 62, "de_mitte");
region(63, 63, "de_bayern");
region(64, 67, "de_mitte");
region(68, 79, "de_bw");
region(80, 87, "de_bayern");
region(88, 89, "de_bw");
region(90, 97, "de_bayern");
region(98, 99, "de_ost");

function germanRegion(postal: string): string | null {
  return /^\d{5}$/.test(postal) ? (DE_POSTAL[postal.slice(0, 2)] ?? null) : null;
}

/** The form row a person counts in, by country of residence (ISO) and, in Austria's variant, postal code. */
export function statsRowFor(variant: StatsVariant, country: string | null, postal: string | null): string {
  if (!country) return "unknown";
  const c = country.toUpperCase();
  if (variant === "CH") return c;
  const keys = new Set(statsRows(variant).map((r) => r.key));
  if (variant === "AT") {
    if (c === "AT") return (postal && austrianState(postal.trim())) || "at_unknown_state";
    if (c === "DE") return (postal && germanRegion(postal.trim())) || "de_unknown_region";
    if (c === "LI") return "CH";
    if (c === "MC") return "FR";
    if (c === "HK" || c === "MO") return "CN";
    if (keys.has(c)) return c;
    if ("AM AZ BY GE KG KZ MD TJ TM UZ".split(" ").includes(c)) return "cis";
    if ("AL BA ME MK RS XK".split(" ").includes(c)) return "se_europe";
    if ("BN ID KH LA MM MY PH SG TH TL VN".split(" ").includes(c)) return "se_asia";
    if ("BH IQ JO KW LB OM PS QA SY YE".split(" ").includes(c)) return "arab_asia";
    if (AFRICA.includes(c)) return "other_africa";
    if (ASIA.includes(c)) return "other_asia";
    if (CENTRAL_AMERICA.includes(c) || SOUTH_AMERICA.includes(c)) return "latin_america";
    return "other";
  }
  if (c === "LI") return "CH";
  if (c === "HK") return "CN";
  if (keys.has(c)) return c;
  if ("AE BH KW OM QA SA".split(" ").includes(c)) return "gulf";
  if (EUROPE.includes(c)) return "other_europe";
  if (AFRICA.includes(c)) return "other_africa";
  if (CENTRAL_AMERICA.includes(c)) return "other_central_america";
  if (SOUTH_AMERICA.includes(c)) return "other_south_america";
  if (NORTH_AMERICA.includes(c)) return "other_north_america";
  if (ASIA.includes(c)) return "other_asia";
  if (OCEANIA.includes(c)) return "NZ";
  return "unknown";
}

export interface StatsStay {
  arrival: string;
  departure: string;
  persons: number;
  row: string;
}

export interface MonthCount {
  rows: Record<string, { arrivals: number; nights: number }>;
  arrivals: number;
  nights: number;
}

const dayNumber = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/** The first day of a month "YYYY-MM" and the first day of the next. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

/** Arrivals (stays beginning in the month) and overnight stays (person-nights in the month), per row. */
export function countMonth(stays: StatsStay[], month: string): MonthCount {
  const { from, to } = monthBounds(month);
  const out: MonthCount = { rows: {}, arrivals: 0, nights: 0 };
  for (const s of stays) {
    const nights = Math.max(0, Math.min(dayNumber(s.departure), dayNumber(to)) - Math.max(dayNumber(s.arrival), dayNumber(from)));
    // a stay without a night (day use) counts neither as an arrival nor as nights
    if (s.departure <= s.arrival) continue;
    const arrives = s.arrival >= from && s.arrival < to;
    if (!nights && !arrives) continue;
    const r = (out.rows[s.row] ??= { arrivals: 0, nights: 0 });
    r.arrivals += arrives ? s.persons : 0;
    r.nights += nights * s.persons;
    out.arrivals += arrives ? s.persons : 0;
    out.nights += nights * s.persons;
  }
  return out;
}
