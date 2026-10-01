/**
 * Shell and settings labels in English and German. German words for glossary
 * terms come from docs/glossary/german-terms.md (one fixed word per term).
 */
import type { Language } from "@hoteloftware/domain";

const catalog = {
  // shell
  "shell.menu": { en: "Menu", de: "Menü" },
  "shell.mainMenu": { en: "Main Menu", de: "Hauptmenü" },
  "shell.findFunction": { en: "Find a list or function", de: "Liste oder Funktion suchen" },
  "shell.nothingFound": { en: "Nothing found.", de: "Nichts gefunden." },
  "shell.quickAccess": { en: "Quick Access", de: "Schnellzugriff" },
  "shell.search": { en: "Search", de: "Suche" },
  "shell.allProperties": { en: "All properties", de: "Alle Betriebe" },
  "shell.properties": { en: "properties", de: "Betriebe" },
  "shell.property": { en: "Property", de: "Betrieb" },
  "shell.newReservation": { en: "New reservation", de: "Neue Reservierung" },
  "shell.pin": { en: "Pin", de: "Anheften" },
  "shell.unpin": { en: "Unpin", de: "Lösen" },
  "shell.pinned": { en: "pinned", de: "angeheftet" },
  "shell.close": { en: "Close", de: "Schließen" },
  "shell.theme": { en: "Theme", de: "Darstellung" },
  "shell.theme.light": { en: "Light", de: "Hell" },
  "shell.theme.dark": { en: "Dark", de: "Dunkel" },
  "shell.theme.system": { en: "System", de: "System" },
  "shell.language": { en: "Language", de: "Sprache" },
  "shell.signOut": { en: "Sign out", de: "Abmelden" },
  "shell.account": { en: "My account", de: "Mein Konto" },
  "shell.soon": { en: "Not built yet. Arrives with ticket {ticket}.", de: "Noch nicht gebaut. Kommt mit Ticket {ticket}." },
  "shell.workspaceTabs": { en: "Workspace Tabs", de: "Arbeitsbereich-Tabs" },
  "shell.notifications": { en: "Notifications", de: "Benachrichtigungen" },
  "shell.liveUpdatesOff": { en: "Live updates unavailable, reconnecting…", de: "Live-Updates nicht verfügbar, verbinde erneut…" },
  "shell.addToQuickAccess": { en: "Add to Quick Access", de: "Zum Schnellzugriff hinzufügen" },
  "shell.removeFromQuickAccess": { en: "Remove from Quick Access", de: "Aus Schnellzugriff entfernen" },

  // menu groups
  "group.front_desk": { en: "Front desk", de: "Rezeption" },
  "group.lists": { en: "Lists", de: "Listen" },
  "group.cash_billing": { en: "Cash and billing", de: "Kasse und Abrechnung" },
  "group.rates": { en: "Rates and availability", de: "Raten und Verfügbarkeit" },
  "group.guests": { en: "Guests", de: "Gäste" },
  "group.housekeeping": { en: "Housekeeping", de: "Housekeeping" },
  "group.reports": { en: "Reports", de: "Berichte" },
  "group.settings": { en: "Settings", de: "Einstellungen" },

  // modules (glossary terms where one exists)
  "module.today": { en: "Today", de: "Heute" },
  "module.calendar": { en: "Calendar", de: "Zimmerplan" },
  "module.arrivals": { en: "Arrivals", de: "Anreisen" },
  "module.departures": { en: "Departures", de: "Abreisen" },
  "module.new_reservation": { en: "New reservation", de: "Neue Reservierung" },
  "module.registration": { en: "Meldeschein", de: "Meldeschein" },
  "module.house_list": { en: "House list", de: "Hausliste" },
  "module.breakfast_list": { en: "Breakfast list", de: "Frühstücksliste" },
  "module.in_house": { en: "In-house guests", de: "Gäste im Haus" },
  "module.downtime_reports": { en: "Downtime Reports", de: "Notfalllisten" },
  "module.cash_book": { en: "Cash Book", de: "Kassenbuch" },
  "module.open_folios": { en: "Open Folios", de: "Offene Folios" },
  "module.invoices": { en: "Invoices", de: "Rechnungen" },
  "module.payments": { en: "Payments", de: "Zahlungen" },
  "module.night_audit": { en: "Night Audit", de: "Tagesabschluss" },
  "module.rates": { en: "Rates", de: "Raten" },
  "module.availability": { en: "Availability", de: "Verfügbarkeit" },
  "module.channel_sync": { en: "Channel Manager status", de: "Channel-Manager-Status" },
  "module.guests": { en: "Guest profiles", de: "Gäste" },
  "module.companies": { en: "Companies", de: "Firmen" },
  "module.guest_inbox": { en: "Guest Inbox", de: "Posteingang" },
  "module.housekeeping": { en: "Cleanliness", de: "Reinigungsstatus" },
  "module.housekeeping_tasks": { en: "Housekeeping Tasks", de: "Reinigungsaufträge" },
  "module.maintenance": { en: "Maintenance Issues", de: "Reparaturmeldungen" },
  "module.lost_found": { en: "Lost and found", de: "Fundsachen" },
  "module.reports": { en: "Reports", de: "Berichte" },
  "module.city_tax_report": { en: "City Tax report", de: "Beherbergungsabgabe" },
  "module.outlets": { en: "Outlets", de: "Outlets" },
  "module.settings_tenant": { en: "Tenant", de: "Mandant" },
  "module.settings_legal_entities": { en: "Legal Entities", de: "Gesellschaften" },
  "module.settings_properties": { en: "Properties", de: "Betriebe" },
  "module.settings_users": { en: "Users and roles", de: "Benutzer und Rollen" },
  "module.settings_devices": { en: "Devices", de: "Geräte" },
  "module.settings_rooms": { en: "Room Types and Rooms", de: "Zimmerkategorien und Zimmer" },
  "module.settings_account": { en: "My account", de: "Mein Konto" },

  // roles (German words proposed here; the glossary names only the terms Tenant Role and Property Role)
  "role.owner": { en: "Owner", de: "Inhaber" },
  "role.tenant_admin": { en: "Tenant Admin", de: "Mandanten-Admin" },
  "role.property_manager": { en: "Property Manager", de: "Hotelleitung" },
  "role.front_desk": { en: "Front Desk", de: "Rezeption" },
  "role.housekeeper": { en: "Housekeeper", de: "Zimmerreinigung" },
  "role.housekeeping_supervisor": { en: "Housekeeping Supervisor", de: "Hausdame" },
  "role.maintenance": { en: "Maintenance", de: "Haustechnik" },
  "role.accounting": { en: "Accounting", de: "Buchhaltung" },
  "role.revenue": { en: "Revenue", de: "Revenue" },
  "role.service": { en: "Service", de: "Service" },
  "role.spa_staff": { en: "Spa Staff", de: "Spa-Mitarbeiter" },
  "role.outlet_manager": { en: "Outlet Manager", de: "Outlet-Leitung" },

  // settings pages
  "settings.tenant.title": { en: "Tenant", de: "Mandant" },
  "settings.tenant.accent": { en: "Accent colour", de: "Akzentfarbe" },
  "settings.tenant.accentHelp": { en: "Used by every user of {tenant} in light and dark mode.", de: "Gilt für alle Benutzer von {tenant}, hell und dunkel." },
  "settings.account.title": { en: "My account", de: "Mein Konto" },
  "settings.account.quickAccessHelp": { en: "Pick up to eight functions for the navbar, or use the star in the Main Menu. Leave all empty for the defaults of your roles.", de: "Bis zu acht Funktionen für die Navigationsleiste, oder der Stern im Hauptmenü. Nichts auswählen für die Vorgaben Ihrer Rollen." },
  "settings.legalEntities.title": { en: "Legal Entities", de: "Gesellschaften" },
  "settings.legalEntities.new": { en: "New Legal Entity", de: "Neue Gesellschaft" },
  "settings.legalEntities.none": { en: "No Legal Entity yet. Every Property belongs to exactly one.", de: "Noch keine Gesellschaft. Jeder Betrieb gehört zu genau einer." },
  "settings.properties.title": { en: "Properties", de: "Betriebe" },
  "settings.properties.new": { en: "New Property", de: "Neuer Betrieb" },
  "settings.properties.needLegalEntity": { en: "Create a Legal Entity first; every Property belongs to one.", de: "Zuerst eine Gesellschaft anlegen; jeder Betrieb gehört zu einer." },
  "settings.users.title": { en: "Users", de: "Benutzer" },
  "settings.users.invite": { en: "Invite a user", de: "Benutzer einladen" },
  "settings.users.noneManaged": { en: "You do not manage users at any property.", de: "Sie verwalten an keinem Betrieb Benutzer." },
  "settings.users.invited": { en: "invited", de: "eingeladen" },
  "settings.users.noRoles": { en: "no roles", de: "keine Rollen" },
  "settings.users.noUsername": { en: "no Username yet", de: "noch kein Benutzername" },
  "settings.users.tenantRole": { en: "Tenant Role", de: "Mandantenrolle" },
  "settings.users.none": { en: "none", de: "keine" },
  "settings.users.otherProperty": { en: "other property", de: "anderer Betrieb" },
  "settings.legalEntities.noAddress": { en: "no address", de: "keine Adresse" },
  "settings.legalEntities.noVatId": { en: "no VAT ID", de: "keine USt-IdNr." },

  // fields
  "field.name": { en: "Name", de: "Name" },
  "field.emailForInvitation": { en: "Email (for the invitation)", de: "E-Mail (für die Einladung)" },
  "field.username": { en: "Username (for signing in)", de: "Benutzername (zum Anmelden)" },
  "field.legalEntityName": { en: "Name of the Legal Entity", de: "Name der Gesellschaft" },
  "field.vatId": { en: "VAT ID", de: "USt-IdNr." },
  "field.addressLine1": { en: "Address line 1", de: "Adresszeile 1" },
  "field.addressLine2": { en: "Address line 2", de: "Adresszeile 2" },
  "field.postalCode": { en: "Postal code", de: "PLZ" },
  "field.city": { en: "City", de: "Ort" },
  "field.country": { en: "Country", de: "Land" },
  "field.accountHolder": { en: "Account holder", de: "Kontoinhaber" },
  "field.iban": { en: "IBAN", de: "IBAN" },
  "field.bic": { en: "BIC", de: "BIC" },
  "field.propertyName": { en: "Property name", de: "Name des Betriebs" },
  "field.legalEntity": { en: "Legal Entity", de: "Gesellschaft" },
  "field.timeZone": { en: "Time zone", de: "Zeitzone" },
  "field.currency": { en: "Currency", de: "Währung" },

  // actions
  "action.save": { en: "Save", de: "Speichern" },
  "action.create": { en: "Create", de: "Anlegen" },
  "action.createInvitation": { en: "Create invitation", de: "Einladung erstellen" },
  "action.saving": { en: "Saving…", de: "Speichern…" },
  "action.saved": { en: "Saved.", de: "Gespeichert." },

  // home
  "home.signedInTo": { en: "Signed in to", de: "Angemeldet bei" },
  "home.yourProperties": { en: "Your properties", de: "Ihre Betriebe" },
  "home.noProperty": { en: "No property yet.", de: "Noch kein Betrieb." },
  "home.createInSettings": { en: "Create one in settings.", de: "In den Einstellungen anlegen." },
  "home.askForRole": { en: "Ask your manager for a role.", de: "Bitten Sie Ihre Leitung um eine Rolle." },
} as const satisfies Record<string, Record<Language, string>>;

export type MessageKey = keyof typeof catalog;
export const MESSAGE_KEYS = Object.keys(catalog) as MessageKey[];

export type Messages = Record<MessageKey, string>;

export function messagesFor(language: Language): Messages {
  const out = {} as Messages;
  for (const key of MESSAGE_KEYS) out[key] = catalog[key][language];
  return out;
}

/** Fill `{name}` placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}
