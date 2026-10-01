/** Companies (folio domain model): booker or bill-to with payment terms and default Routing Rules. */

/** Which charges a Company's default Routing Rules send to the Company's folio (the folio tickets apply them). */
export const ROUTING_CATEGORIES = ["accommodation", "package", "extras", "city_tax"] as const;
export type RoutingCategory = (typeof ROUTING_CATEGORIES)[number];
