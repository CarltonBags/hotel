import { FLOOR_LANGUAGES, type FloorLanguage } from "@hoteloftware/domain";

/**
 * The phone view's words in its ten languages (ticket 35), in the order of
 * FLOOR_LANGUAGES: de, en, pl, ro, bg, hr (Croatian, Serbian, Bosnian),
 * hu, tr, uk, ar. Icons and colours always go with them. Placeholders in
 * braces are filled by fillFloor.
 */
const T = {
  "title.rooms": ["Meine Zimmer", "My rooms", "Moje pokoje", "Camerele mele", "Моите стаи", "Moje sobe", "Szobáim", "Odalarım", "Мої кімнати", "غرفي"],
  "title.problems": ["Störungen", "Problems", "Usterki", "Probleme", "Проблеми", "Kvarovi", "Hibák", "Arızalar", "Несправності", "الأعطال"],
  "progress": ["{done}/{total} · noch {min} Min.", "{done}/{total} · {min} min left", "{done}/{total} · zostało {min} min", "{done}/{total} · {min} min rămase", "{done}/{total} · остават {min} мин", "{done}/{total} · još {min} min", "{done}/{total} · még {min} perc", "{done}/{total} · {min} dk kaldı", "{done}/{total} · залишилось {min} хв", "{done}/{total} · متبقٍ {min} دقيقة"],
  "kind.departure": ["Abreise", "Departure", "Wyjazd", "Plecare", "Заминаване", "Odlazak", "Távozás", "Çıkış", "Виїзд", "مغادرة"],
  "kind.stayover": ["Bleibe", "Stayover", "Pobyt", "Sejur", "Престой", "Boravak", "Maradó vendég", "Konaklama", "Проживання", "إقامة"],
  "kind.arrival": ["Anreise", "Arrival", "Przyjazd", "Sosire", "Пристигане", "Dolazak", "Érkezés", "Giriş", "Заїзд", "وصول"],
  "kind.linen": ["Wäschewechsel", "Linen", "Zmiana pościeli", "Lenjerie", "Смяна на бельо", "Posteljina", "Ágyneműcsere", "Çarşaf", "Білизна", "تغيير البياضات"],
  "kind.clean": ["Zusatzreinigung", "Extra clean", "Dodatkowe sprzątanie", "Curățenie extra", "Допълнително почистване", "Dodatno čišćenje", "Extra takarítás", "Ek temizlik", "Додаткове прибирання", "تنظيف إضافي"],
  "status.in_progress": ["In Arbeit", "In progress", "W trakcie", "În lucru", "В процес", "U tijeku", "Folyamatban", "Devam ediyor", "У роботі", "قيد العمل"],
  "status.done": ["Erledigt", "Done", "Gotowe", "Gata", "Готово", "Gotovo", "Kész", "Bitti", "Готово", "تم"],
  "status.skipped": ["Ausgelassen", "Skipped", "Pominięte", "Omis", "Пропуснато", "Preskočeno", "Kihagyva", "Atlandı", "Пропущено", "تم التخطي"],
  "flag.waiting": ["Gast wartet", "Guest waiting", "Gość czeka", "Oaspetele așteaptă", "Гостът чака", "Gost čeka", "Vendég vár", "Misafir bekliyor", "Гість чекає", "الضيف ينتظر"],
  "flag.vip": ["VIP", "VIP", "VIP", "VIP", "VIP", "VIP", "VIP", "VIP", "VIP", "VIP"],
  "flag.changed": ["Geändert", "Changed", "Zmienione", "Modificat", "Променено", "Promijenjeno", "Módosítva", "Değişti", "Змінено", "تم التغيير"],
  "flag.pending": ["Wartet auf Senden", "Waiting to send", "Czeka na wysłanie", "Așteaptă trimiterea", "Чака изпращане", "Čeka slanje", "Küldésre vár", "Gönderilmeyi bekliyor", "Очікує надсилання", "بانتظار الإرسال"],
  "start": ["Start", "Start", "Start", "Start", "Старт", "Početak", "Kezdés", "Başla", "Почати", "ابدأ"],
  "done": ["Fertig", "Done", "Gotowe", "Gata", "Готово", "Gotovo", "Kész", "Bitti", "Готово", "تم"],
  "undo": ["Rückgängig", "Undo", "Cofnij", "Anulează", "Отмени", "Poništi", "Visszavonás", "Geri al", "Скасувати", "تراجع"],
  "declined": ["Gast lehnt ab", "Guest declined", "Gość odmówił", "Oaspetele a refuzat", "Гостът отказа", "Gost odbio", "Vendég nem kéri", "Misafir istemedi", "Гість відмовився", "رفض الضيف"],
  "dnd": ["Bitte nicht stören", "Do not disturb", "Nie przeszkadzać", "Nu deranjați", "Не безпокойте", "Ne smetaj", "Ne zavarjanak", "Rahatsız etmeyin", "Не турбувати", "عدم الإزعاج"],
  "minibar": ["Minibar", "Minibar", "Minibar", "Minibar", "Минибар", "Minibar", "Minibár", "Minibar", "Мінібар", "الميني بار"],
  "minibar.save": ["Minibar buchen", "Post minibar", "Zaksięguj minibar", "Înregistrează minibarul", "Запиши минибара", "Knjiži minibar", "Minibár könyvelése", "Minibarı kaydet", "Записати мінібар", "تسجيل الميني بار"],
  "problem": ["Störung melden", "Report problem", "Zgłoś problem", "Raportează o problemă", "Съобщи за проблем", "Prijavi kvar", "Hiba bejelentése", "Arıza bildir", "Повідомити про несправність", "الإبلاغ عن عطل"],
  "lost": ["Fundsache", "Lost and found", "Rzecz znaleziona", "Obiect găsit", "Намерена вещ", "Izgubljeno-nađeno", "Talált tárgy", "Kayıp eşya", "Знахідка", "مفقودات"],
  "photo": ["Foto aufnehmen", "Take photo", "Zrób zdjęcie", "Fă o fotografie", "Снимай", "Fotografiraj", "Fotó készítése", "Fotoğraf çek", "Зробити фото", "التقط صورة"],
  "noPhoto": ["Ohne Foto weiter", "Continue without photo", "Dalej bez zdjęcia", "Continuă fără fotografie", "Продължи без снимка", "Nastavi bez fotografije", "Tovább fotó nélkül", "Fotoğrafsız devam et", "Продовжити без фото", "المتابعة بدون صورة"],
  "save": ["Speichern", "Save", "Zapisz", "Salvează", "Запази", "Spremi", "Mentés", "Kaydet", "Зберегти", "حفظ"],
  "cancel": ["Abbrechen", "Cancel", "Anuluj", "Renunță", "Отказ", "Odustani", "Mégse", "İptal", "Скасувати", "إلغاء"],
  "close": ["Schließen", "Close", "Zamknij", "Închide", "Затвори", "Zatvori", "Bezárás", "Kapat", "Закрити", "إغلاق"],
  "note": ["Notiz (freiwillig)", "Note (optional)", "Notatka (opcjonalnie)", "Notă (opțional)", "Бележка (по желание)", "Bilješka (neobavezno)", "Megjegyzés (nem kötelező)", "Not (isteğe bağlı)", "Примітка (необов’язково)", "ملاحظة (اختياري)"],
  "urgency.now": ["Sofort", "Now", "Teraz", "Acum", "Веднага", "Odmah", "Azonnal", "Hemen", "Негайно", "الآن"],
  "urgency.today": ["Heute", "Today", "Dziś", "Azi", "Днес", "Danas", "Ma", "Bugün", "Сьогодні", "اليوم"],
  "urgency.later": ["Später", "Later", "Później", "Mai târziu", "По-късно", "Kasnije", "Később", "Sonra", "Пізніше", "لاحقًا"],
  "pick.plumbing": ["Wasser, Abfluss", "Water, drain", "Woda, odpływ", "Apă, scurgere", "Вода, канал", "Voda, odvod", "Víz, lefolyó", "Su, gider", "Вода, злив", "ماء، تصريف"],
  "pick.electrical": ["Licht, Strom", "Light, power", "Światło, prąd", "Lumină, curent", "Осветление, ток", "Svjetlo, struja", "Világítás, áram", "Işık, elektrik", "Світло, струм", "إضاءة، كهرباء"],
  "pick.heating": ["Heizung, Klima", "Heating, cooling", "Ogrzewanie, klimatyzacja", "Încălzire, climă", "Отопление, климатик", "Grijanje, klima", "Fűtés, klíma", "Isıtma, klima", "Опалення, кондиціонер", "تدفئة، تكييف"],
  "pick.furniture": ["Möbel", "Furniture", "Meble", "Mobilier", "Мебели", "Namještaj", "Bútor", "Mobilya", "Меблі", "أثاث"],
  "pick.door": ["Tür, Schloss", "Door, lock", "Drzwi, zamek", "Ușă, încuietoare", "Врата, ключалка", "Vrata, brava", "Ajtó, zár", "Kapı, kilit", "Двері, замок", "باب، قفل"],
  "pick.other": ["Anderes", "Other", "Inne", "Altceva", "Друго", "Ostalo", "Egyéb", "Diğer", "Інше", "أخرى"],
  "lost.clothing": ["Kleidung", "Clothing", "Ubranie", "Îmbrăcăminte", "Дрехи", "Odjeća", "Ruha", "Giysi", "Одяг", "ملابس"],
  "lost.electronics": ["Elektronik", "Electronics", "Elektronika", "Electronice", "Електроника", "Elektronika", "Elektronika", "Elektronik", "Електроніка", "إلكترونيات"],
  "lost.documents": ["Dokumente", "Documents", "Dokumenty", "Documente", "Документи", "Dokumenti", "Iratok", "Belgeler", "Документи", "مستندات"],
  "lost.valuables": ["Wertsachen", "Valuables", "Kosztowności", "Obiecte de valoare", "Ценности", "Dragocjenosti", "Értéktárgy", "Değerli eşya", "Цінності", "أشياء ثمينة"],
  "lost.other": ["Anderes", "Other", "Inne", "Altceva", "Друго", "Ostalo", "Egyéb", "Diğer", "Інше", "أخرى"],
  "hknote.feather_allergy": ["Federallergie", "Feather allergy", "Alergia na pierze", "Alergie la pene", "Алергия към пера", "Alergija na perje", "Tollallergia", "Tüy alerjisi", "Алергія на пір’я", "حساسية من الريش"],
  "hknote.baby_cot": ["Babybett", "Baby cot", "Łóżeczko", "Pătuț", "Бебешко креватче", "Dječji krevetić", "Babaágy", "Bebek yatağı", "Дитяче ліжечко", "سرير أطفال"],
  "hknote.extra_bed": ["Zustellbett", "Extra bed", "Dostawka", "Pat suplimentar", "Допълнително легло", "Pomoćni ležaj", "Pótágy", "İlave yatak", "Додаткове ліжко", "سرير إضافي"],
  "hknote.welcome_gift": ["Willkommensgeschenk", "Welcome gift", "Prezent powitalny", "Cadou de bun venit", "Подарък за добре дошли", "Poklon dobrodošlice", "Üdvözlő ajándék", "Hoş geldin hediyesi", "Вітальний подарунок", "هدية ترحيب"],
  "hknote.late_checkout": ["Später Check-out", "Late checkout", "Późne wymeldowanie", "Check-out târziu", "Късно напускане", "Kasna odjava", "Késői kijelentkezés", "Geç çıkış", "Пізній виїзд", "مغادرة متأخرة"],
  "hknote.pet": ["Haustier", "Pet", "Zwierzę", "Animal de companie", "Домашен любимец", "Kućni ljubimac", "Háziállat", "Evcil hayvan", "Домашня тварина", "حيوان أليف"],
  "hknote.accessibility": ["Barrierefreiheit", "Accessibility need", "Potrzeby dostępności", "Nevoi de accesibilitate", "Нужда от достъпност", "Potreba pristupačnosti", "Akadálymentesség", "Erişilebilirlik ihtiyacı", "Потреба доступності", "احتياجات الوصول"],
  "take": ["Übernehme ich", "I take it", "Biorę to", "Mă ocup eu", "Поемам", "Preuzimam", "Elvállalom", "Ben alıyorum", "Беру", "سأتولاها"],
  "fixed": ["Behoben", "Fixed", "Naprawione", "Rezolvat", "Поправено", "Popravljeno", "Megjavítva", "Düzeltildi", "Виправлено", "تم الإصلاح"],
  "endBlock": ["Sperre beenden – Zimmer wird schmutzig", "End the block – room turns Dirty", "Zakończ blokadę – pokój do sprzątania", "Încheie blocarea – camera devine murdară", "Прекрати блокировката – стаята става мръсна", "Završi blokadu – soba postaje prljava", "Zárolás vége – a szoba piszkos lesz", "Engeli kaldır – oda kirli olur", "Зняти блокування – кімната стане брудною", "إنهاء الحجب – تصبح الغرفة متسخة"],
  "keepBlock": ["Sperre behalten", "Keep the block", "Zachowaj blokadę", "Păstrează blocarea", "Запази блокировката", "Zadrži blokadu", "Zárolás marad", "Engeli koru", "Залишити блокування", "إبقاء الحجب"],
  "reportedBy": ["gemeldet von {name}", "reported by {name}", "zgłosił(a) {name}", "raportat de {name}", "съобщено от {name}", "prijavio/la {name}", "bejelentette: {name}", "bildiren: {name}", "повідомив(ла) {name}", "أبلغ عنه {name}"],
  "block.out_of_order": ["Außer Betrieb", "Out of Order", "Wyłączony", "Scos din uz", "Извън експлоатация", "Izvan funkcije", "Üzemen kívül", "Hizmet dışı", "Не працює", "خارج الخدمة"],
  "block.out_of_service": ["Eingeschränkt", "Out of Service", "Ograniczony", "Restricționat", "Ограничено", "Ograničeno", "Korlátozott", "Kısıtlı", "Обмежено", "خدمة محدودة"],
  "offline": ["Offline – Änderungen werden gesendet, sobald Netz da ist", "Offline – changes are sent when the connection returns", "Offline – zmiany zostaną wysłane po odzyskaniu połączenia", "Offline – modificările se trimit când revine conexiunea", "Офлайн – промените се изпращат при връзка", "Offline – promjene se šalju kad se veza vrati", "Offline – a változásokat a kapcsolat visszatértekor küldjük", "Çevrimdışı – değişiklikler bağlantı gelince gönderilir", "Офлайн – зміни надішлемо, щойно з’явиться зв’язок", "غير متصل – تُرسل التغييرات عند عودة الاتصال"],
  "waiting": ["{n} warten auf Senden", "{n} waiting to send", "{n} czeka na wysłanie", "{n} așteaptă trimiterea", "{n} чакат изпращане", "{n} čeka slanje", "{n} küldésre vár", "{n} gönderilmeyi bekliyor", "{n} очікують надсилання", "{n} بانتظار الإرسال"],
  "conflict": ["Zimmer {room} wurde inzwischen von der Leitung geändert; deine Änderung wurde nicht übernommen.", "Room {room} was changed by your supervisor meanwhile; your change was not applied.", "Pokój {room} został w międzyczasie zmieniony przez przełożoną; twoja zmiana nie została zapisana.", "Camera {room} a fost modificată între timp de supervizor; modificarea ta nu a fost aplicată.", "Стая {room} междувременно е променена от ръководителя; промяната ти не е приложена.", "Sobu {room} je u međuvremenu promijenila voditeljica; tvoja promjena nije primijenjena.", "A(z) {room} szobát közben a vezető módosította; a te módosításod nem lett mentve.", "{room} numaralı oda bu arada amirin tarafından değiştirildi; değişikliğin uygulanmadı.", "Кімнату {room} тим часом змінила керівниця; твою зміну не застосовано.", "غيّرت المشرفة الغرفة {room} في الأثناء؛ لم يُطبَّق تغييرك."],
  "refused": ["Nicht gespeichert: {message}", "Not saved: {message}", "Nie zapisano: {message}", "Nesalvat: {message}", "Не е запазено: {message}", "Nije spremljeno: {message}", "Nincs mentve: {message}", "Kaydedilmedi: {message}", "Не збережено: {message}", "لم يُحفظ: {message}"],
  "notPublished": ["Der heutige Plan ist noch nicht veröffentlicht.", "Today's plan is not published yet.", "Dzisiejszy plan nie jest jeszcze opublikowany.", "Planul de azi nu este încă publicat.", "Днешният план още не е публикуван.", "Današnji plan još nije objavljen.", "A mai terv még nincs közzétéve.", "Bugünün planı henüz yayınlanmadı.", "Сьогоднішній план ще не опубліковано.", "لم تُنشر خطة اليوم بعد."],
  "noRooms": ["Heute keine Zimmer für dich.", "No rooms for you today.", "Dziś nie masz pokoi.", "Nicio cameră pentru tine azi.", "Днес нямаш стаи.", "Danas nemaš soba.", "Ma nincs szobád.", "Bugün sana oda yok.", "Сьогодні кімнат для тебе немає.", "لا غرف لك اليوم."],
  "noProblems": ["Keine offenen Störungen.", "No open problems.", "Brak otwartych usterek.", "Nicio problemă deschisă.", "Няма открити проблеми.", "Nema otvorenih kvarova.", "Nincs nyitott hiba.", "Açık arıza yok.", "Відкритих несправностей немає.", "لا أعطال مفتوحة."],
  "otherRooms": ["Weitere Zimmer", "Other rooms", "Pozostałe pokoje", "Alte camere", "Други стаи", "Ostale sobe", "Egyéb szobák", "Diğer odalar", "Інші кімнати", "غرف أخرى"],
  "people": ["{n} Pers.", "{n} guests", "{n} os.", "{n} pers.", "{n} души", "{n} os.", "{n} fő", "{n} kişi", "{n} ос.", "{n} أشخاص"],
  "until": ["bis {date}", "until {date}", "do {date}", "până la {date}", "до {date}", "do {date}", "{date}-ig", "{date} tarihine kadar", "до {date}", "حتى {date}"],
  "minutes": ["{n} Min.", "{n} min", "{n} min", "{n} min", "{n} мин", "{n} min", "{n} perc", "{n} dk", "{n} хв", "{n} دقيقة"],
  "language": ["Sprache", "Language", "Język", "Limbă", "Език", "Jezik", "Nyelv", "Dil", "Мова", "اللغة"],
  "lock": ["Sperren", "Lock", "Zablokuj", "Blochează", "Заключи", "Zaključaj", "Zárolás", "Kilitle", "Заблокувати", "قفل"],
  "board": ["Zur Übersicht", "To the board", "Do tablicy", "La panou", "Към таблото", "Na ploču", "A táblához", "Panoya git", "До дошки", "إلى اللوحة"],
  "sent": ["Gesendet", "Sent", "Wysłano", "Trimis", "Изпратено", "Poslano", "Elküldve", "Gönderildi", "Надіслано", "تم الإرسال"],
  "noGuest": ["Kein Gast im Zimmer", "No guest in the room", "Brak gościa w pokoju", "Niciun oaspete în cameră", "Няма гост в стаята", "Nema gosta u sobi", "Nincs vendég a szobában", "Odada misafir yok", "У кімнаті немає гостя", "لا ضيف في الغرفة"],
} as const satisfies Record<string, readonly [string, string, string, string, string, string, string, string, string, string]>;

export type FloorKey = keyof typeof T;
export type FloorMessages = Record<FloorKey, string>;

/** The language names as shown in the picker, each in itself. */
export const FLOOR_LANGUAGE_NAMES: Record<FloorLanguage, string> = {
  de: "Deutsch",
  en: "English",
  pl: "Polski",
  ro: "Română",
  bg: "Български",
  hr: "Hrvatski / Srpski / Bosanski",
  hu: "Magyar",
  tr: "Türkçe",
  uk: "Українська",
  ar: "العربية",
};

export function floorMessages(language: FloorLanguage): FloorMessages {
  const i = FLOOR_LANGUAGES.indexOf(language);
  const out = {} as FloorMessages;
  for (const key of Object.keys(T) as FloorKey[]) out[key] = T[key][i]!;
  return out;
}

export function fillFloor(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}
