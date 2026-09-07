import type { NewsSource } from './news.types';

// ────────────────────────────────────────────────────────────────────
// THE PAPERS WE POLL — A CHECKED-IN TABLE, NOT A DATABASE THE OPERATOR EDITS.
//
// A registry in code is reviewable, diffable and deployable; a registry in a
// table is a screen nobody builds and a row nobody can explain. The DB copy
// (NewsSource) exists only so the poll can record lastPolledAt/lastError
// against something, and it is upserted FROM here on every run.
//
// ⚠️ EVERY FEED IN THIS FILE WAS FETCHED AND PARSED LIVE ON 2026-09-07 and
// yielded at least one item. 213 candidate URLs were probed to find them:
// most South African local papers publish nothing, answer /feed/ with an HTML
// page, or have been folded into a sister title. DO NOT ADD A FEED YOU HAVE
// NOT FETCHED — a dead URL costs the poll a 20-second timeout every night and
// tells nobody it is dead until somebody reads lastError.
//
// ⚠️ SYNDICATION IS THE NORM, SO ALIASES ARE DELIBERATELY ABSENT. Fifteen
// domains that answered were serving another title's feed verbatim
// (barbertontimes / corridorgazette / hazyviewherald / nelspruitpost →
// Lowvelder; tembisan → Kempton Express; kathorusmail → Germiston City News;
// joburgeastexpress → Bedfordview Edenvale News; rekordeast/moot/centurion →
// Rekord; estcourtnews / ladysmithgazette / vryheidherald → Northern Natal
// News; maritzburgsun / capitalnewspapers → The Witness; comarochronicle →
// Southern Courier; phoenixsun → Rising Sun; northeasterntribune → Rosebank
// Killarney Gazette; standertonadvertiser → Ridge Times). Each is listed ONCE,
// under the title the feed actually calls itself, with the alias's towns
// folded in. The article URL is unique anyway, so a duplicate would cost a
// wasted poll rather than a duplicate clipping — but it would also make
// itemCount a lie and hand a member the same cutting twice under two mastheads.
//
// `district` is SAPS's own district wording where we could map it — the
// fallback that lets an article with no coordinates still match a station.
// ⚠️ MATCHED LENIENTLY (see districtMatches in news.service.ts): SAPS writes
// "Ehlanzeni District" and a municipality writes "Ehlanzeni", so the match
// folds case and drops a trailing "district"/"municipality". A wrong district
// here costs a missed clipping, never a wrong one.
//
// lat/lng are NULL on purpose. The poll geocodes towns[0] once and caches it
// in NewsPlace, so this file needs no Maps key to be edited or reviewed.
// ────────────────────────────────────────────────────────────────────

/** The key every Google News fallback article is stored under. */
export const GOOGLE_NEWS_KEY = 'google-news';

/** A local title covers its town and the suburbs around it. */
const LOCAL_KM = 25;
/** A regional title covers a district. */
const REGIONAL_KM = 80;
/**
 * ⚠️ 0 IS NOT "no coverage", it is "no CIRCLE". A national title has no
 * centre, so a circle round it would either match the whole country or
 * nothing; its articles match on their own geocoded place and nothing else.
 */
const NATIONAL_KM = 0;

type Row = Omit<NewsSource, 'lat' | 'lng'>;

const local = (
  key: string,
  name: string,
  domain: string,
  province: string,
  district: string | null,
  towns: string[],
): Row => ({
  key,
  name,
  homepage: `https://${domain}/`,
  feedUrl: `https://${domain}/feed/`,
  province,
  district,
  towns,
  radiusKm: LOCAL_KM,
  kind: 'local',
});

const national = (key: string, name: string, homepage: string, feedUrl: string): Row => ({
  key,
  name,
  homepage,
  feedUrl,
  province: 'National',
  district: null,
  towns: [],
  radiusKm: NATIONAL_KM,
  kind: 'national',
});

const ROWS: Row[] = [
  // ─── Gauteng ─────────────────────────────────────────────────────
  local('rekord', 'Rekord', 'rekord.co.za', 'Gauteng', 'City of Tshwane', [
    'Pretoria',
    'Centurion',
    'Moot',
    'Hatfield',
    'Brooklyn',
    'Garsfontein',
    'Silverton',
    'Akasia',
  ]),
  local('sandton-chronicle', 'Sandton Chronicle', 'sandtonchronicle.co.za', 'Gauteng', 'Johannesburg', [
    'Sandton',
    'Bryanston',
    'Rivonia',
    'Morningside',
    'Wynberg',
  ]),
  local('fourways-review', 'Fourways Review', 'fourwaysreview.co.za', 'Gauteng', 'Johannesburg', [
    'Fourways',
    'Douglasdale',
    'Lonehill',
    'Dainfern',
    'Diepsloot',
  ]),
  local('randburg-sun', 'Randburg Sun', 'randburgsun.co.za', 'Gauteng', 'Johannesburg', [
    'Randburg',
    'Ferndale',
    'Blairgowrie',
    'Cosmo City',
    'Northriding',
  ]),
  local(
    'rosebank-killarney-gazette',
    'Rosebank Killarney Gazette',
    'rosebankkillarneygazette.co.za',
    'Gauteng',
    'Johannesburg',
    ['Rosebank', 'Killarney', 'Parkview', 'Norwood', 'Orange Grove', 'Houghton'],
  ),
  local('southern-courier', 'Southern Courier', 'southerncourier.co.za', 'Gauteng', 'Johannesburg', [
    'Rosettenville',
    'Mondeor',
    'Glenvista',
    'Oakdene',
    'Turffontein',
    'Comaro',
  ]),
  local('alex-news', 'Alex News', 'alexnews.co.za', 'Gauteng', 'Johannesburg', [
    'Alexandra',
    'Marlboro',
    'Wynberg',
  ]),
  local('soweto-urban', 'Soweto Urban', 'sowetourban.co.za', 'Gauteng', 'Johannesburg', [
    'Soweto',
    'Orlando',
    'Diepkloof',
    'Pimville',
    'Meadowlands',
    'Protea Glen',
  ]),
  local('roodepoort-record', 'Roodepoort Record', 'roodepoortrecord.co.za', 'Gauteng', 'Johannesburg', [
    'Roodepoort',
    'Florida',
    'Weltevredenpark',
    'Constantia Kloof',
    'Honeydew',
  ]),
  local('midrand-reporter', 'Midrand Reporter', 'midrandreporter.co.za', 'Gauteng', 'Johannesburg', [
    'Midrand',
    'Halfway House',
    'Noordwyk',
    'Ivory Park',
    'Kyalami',
  ]),
  local(
    'bedfordview-edenvale-news',
    'Bedfordview Edenvale News',
    'bedfordviewedenvalenews.co.za',
    'Gauteng',
    'Ekurhuleni',
    ['Bedfordview', 'Edenvale', 'Sebenza', 'Primrose'],
  ),
  local('germiston-city-news', 'Germiston City News', 'germistoncitynews.co.za', 'Gauteng', 'Ekurhuleni', [
    'Germiston',
    'Katlehong',
    'Thokoza',
    'Vosloorus',
    'Elsburg',
  ]),
  local('alberton-record', 'Alberton Record', 'albertonrecord.co.za', 'Gauteng', 'Ekurhuleni', [
    'Alberton',
    'Brackenhurst',
    'Meyersdal',
    'Newmarket',
    'Tokoza',
  ]),
  local('benoni-city-times', 'Benoni City Times', 'benonicitytimes.co.za', 'Gauteng', 'Ekurhuleni', [
    'Benoni',
    'Daveyton',
    'Rynfield',
    'Northmead',
    'Wattville',
  ]),
  local('boksburg-advertiser', 'Boksburg Advertiser', 'boksburgadvertiser.co.za', 'Gauteng', 'Ekurhuleni', [
    'Boksburg',
    'Bartlett',
    'Reiger Park',
    'Vosloorus',
  ]),
  local('brakpan-herald', 'Brakpan Herald', 'brakpanherald.co.za', 'Gauteng', 'Ekurhuleni', [
    'Brakpan',
    'Tsakane',
    'Dalpark',
  ]),
  local('springs-advertiser', 'Springs Advertiser', 'springsadvertiser.co.za', 'Gauteng', 'Ekurhuleni', [
    'Springs',
    'Kwa-Thema',
    'Selcourt',
    'Bakerton',
  ]),
  local('african-reporter', 'African Reporter', 'africanreporter.co.za', 'Gauteng', 'Ekurhuleni', [
    'Duduza',
    'Nigel',
    'Tsakane',
  ]),
  local('kempton-express', 'Kempton Express', 'kemptonexpress.co.za', 'Gauteng', 'Ekurhuleni', [
    'Kempton Park',
    'Tembisa',
    'Birchleigh',
    'Norkem Park',
    'Bonaero Park',
  ]),
  local('krugersdorp-news', 'Krugersdorp News', 'krugersdorpnews.co.za', 'Gauteng', 'West Rand District', [
    'Krugersdorp',
    'Muldersdrift',
    'Kagiso',
    'Rangeview',
  ]),
  local('randfontein-herald', 'Randfontein Herald', 'randfonteinherald.co.za', 'Gauteng', 'West Rand District', [
    'Randfontein',
    'Mohlakeng',
    'Westonaria',
  ]),
  local('carletonville-herald', 'Carletonville Herald', 'carletonvilleherald.com', 'Gauteng', 'West Rand District', [
    'Carletonville',
    'Fochville',
    'Khutsong',
    'Welverdiend',
  ]),
  local('sedibeng-ster', 'Sedibeng Ster', 'sedibengster.com', 'Gauteng', 'Sedibeng District', [
    'Vereeniging',
    'Vanderbijlpark',
    'Sebokeng',
    'Evaton',
    'Emfuleni',
  ]),
  local('vaalweekblad', 'Vaalweekblad', 'vaalweekblad.com', 'Gauteng', 'Sedibeng District', [
    'Vanderbijlpark',
    'Vereeniging',
    'Sasolburg',
    'Three Rivers',
  ]),
  local(
    'heidelberg-nigel-heraut',
    'Heidelberg Nigel Heraut',
    'heidelbergnigelheraut.co.za',
    'Gauteng',
    'Sedibeng District',
    ['Heidelberg', 'Nigel', 'Ratanda', 'Devon'],
  ),

  // ─── KwaZulu-Natal ───────────────────────────────────────────────
  local('berea-mail', 'Berea Mail', 'bereamail.co.za', 'KwaZulu-Natal', 'eThekwini', [
    'Berea',
    'Durban',
    'Morningside',
    'Glenwood',
    'Musgrave',
    'Overport',
  ]),
  local('highway-mail', 'Highway Mail', 'highwaymail.co.za', 'KwaZulu-Natal', 'eThekwini', [
    'Hillcrest',
    'Kloof',
    'Westville',
    'Pinetown',
    'Gillitts',
    'Waterfall',
  ]),
  local('northglen-news', 'Northglen News', 'northglennews.co.za', 'KwaZulu-Natal', 'eThekwini', [
    'Durban North',
    'Glenashley',
    'Umhlanga',
    'Newlands',
    'Umgeni Park',
  ]),
  local('southlands-sun', 'Southlands Sun', 'southlandssun.co.za', 'KwaZulu-Natal', 'eThekwini', [
    'Montclair',
    'Bluff',
    'Isipingo',
    'Umlazi',
    'Queensburgh',
  ]),
  local('rising-sun', 'Rising Sun Newspapers', 'risingsunnewspapers.co.za', 'KwaZulu-Natal', 'eThekwini', [
    'Chatsworth',
    'Phoenix',
    'Overport',
    'Verulam',
    'Tongaat',
  ]),
  local('south-coast-sun', 'South Coast Sun', 'southcoastsun.co.za', 'KwaZulu-Natal', 'eThekwini', [
    'Amanzimtoti',
    'Kingsburgh',
    'Warner Beach',
    'Illovo',
  ]),
  local('south-coast-herald', 'South Coast Herald', 'southcoastherald.co.za', 'KwaZulu-Natal', 'Ugu District', [
    'Port Shepstone',
    'Margate',
    'Scottburgh',
    'Hibberdene',
    'Ramsgate',
  ]),
  local('north-coast-courier', 'North Coast Courier', 'northcoastcourier.co.za', 'KwaZulu-Natal', 'iLembe District', [
    'Ballito',
    'Stanger',
    'KwaDukuza',
    'Salt Rock',
    'Umhlali',
  ]),
  local('the-witness', 'The Witness', 'witness.co.za', 'KwaZulu-Natal', 'uMgungundlovu District', [
    'Pietermaritzburg',
    'Howick',
    'Hilton',
    'Msunduzi',
    'Edendale',
  ]),
  local('zululand-observer', 'Zululand Observer', 'zululandobserver.co.za', 'KwaZulu-Natal', 'King Cetshwayo District', [
    'Richards Bay',
    'Empangeni',
    'Mtunzini',
    'Eshowe',
    'Melmoth',
  ]),
  local('ilanga', 'Ilanga News', 'ilanganews.co.za', 'KwaZulu-Natal', 'eThekwini', [
    'Durban',
    'Umlazi',
    'KwaMashu',
    'Inanda',
  ]),
  {
    // ⚠️ Four Caxton domains (Newcastle Advertiser, Ladysmith Gazette, Vryheid
    // Herald, Estcourt & Midlands News) now serve this one feed, so its beat is
    // the whole of northern Natal rather than one town.
    ...local(
      'northern-natal-news',
      'Northern Natal News',
      'newcastleadvertiser.co.za',
      'KwaZulu-Natal',
      'Amajuba District',
      ['Newcastle', 'Ladysmith', 'Vryheid', 'Estcourt', 'Dundee', 'Madadeni', 'Osizweni'],
    ),
    radiusKm: REGIONAL_KM,
    kind: 'regional',
  },

  // ─── Mpumalanga ──────────────────────────────────────────────────
  {
    ...local('lowvelder', 'Lowvelder', 'lowvelder.co.za', 'Mpumalanga', 'Ehlanzeni District', [
      'Mbombela',
      'Nelspruit',
      'White River',
      'Barberton',
      'Hazyview',
      'Sabie',
      'Malelane',
      'Komatipoort',
    ]),
    radiusKm: REGIONAL_KM,
    kind: 'regional',
  },
  local('mpumalanga-news', 'Mpumalanga News', 'mpumalanganews.co.za', 'Mpumalanga', 'Ehlanzeni District', [
    'KaNyamazane',
    'Mbombela',
    'Kabokweni',
    'Matsulu',
  ]),
  local('witbank-news', 'Witbank News', 'witbanknews.co.za', 'Mpumalanga', 'Nkangala District', [
    'Emalahleni',
    'Witbank',
    'Middelburg',
    'Ogies',
    'Kriel',
  ]),
  local('ridge-times', 'Ridge Times', 'ridgetimes.co.za', 'Mpumalanga', 'Gert Sibande District', [
    'Secunda',
    'Evander',
    'Bethal',
    'Standerton',
    'Trichardt',
    'Kinross',
  ]),
  local('highvelder', 'Highvelder News', 'highvelder.co.za', 'Mpumalanga', 'Gert Sibande District', [
    'Ermelo',
    'Amsterdam',
    'Chrissiesmeer',
    'Breyten',
  ]),

  // ─── Limpopo ─────────────────────────────────────────────────────
  local('polokwane-review', 'Review', 'reviewonline.co.za', 'Limpopo', 'Capricorn District', [
    'Polokwane',
    'Seshego',
    'Mankweng',
    'Lebowakgomo',
  ]),
  local('letaba-herald', 'Letaba Herald', 'letabaherald.co.za', 'Limpopo', 'Mopani District', [
    'Tzaneen',
    'Letsitele',
    'Nkowankowa',
    'Haenertsburg',
  ]),

  // ─── North West ──────────────────────────────────────────────────
  local(
    'potchefstroom-herald',
    'Potchefstroom Herald',
    'potchefstroomherald.co.za',
    'North West',
    'Dr Kenneth Kaunda District',
    ['Potchefstroom', 'Ikageng', 'Klerksdorp', 'Orkney'],
  ),
  local('kormorant', 'Kormorant', 'kormorant.co.za', 'North West', 'Bojanala District', [
    'Hartbeespoort',
    'Brits',
    'Schoemansville',
    'Ifafi',
    'Broederstroom',
  ]),

  // ─── Free State ──────────────────────────────────────────────────
  local('bloemfontein-courant', 'Bloemfontein Courant', 'bloemfonteincourant.co.za', 'Free State', 'Mangaung', [
    'Bloemfontein',
    'Mangaung',
    'Botshabelo',
    'Thaba Nchu',
  ]),
  local('parys-gazette', 'Parys Gazette', 'parysgazette.co.za', 'Free State', 'Fezile Dabi District', [
    'Parys',
    'Tumahole',
    'Vredefort',
    'Heilbron',
  ]),

  // ─── Northern Cape ───────────────────────────────────────────────
  {
    // ⚠️ /rss/, not /feed/ — this one is not WordPress, and /feed/ is a 404.
    ...local('dfa', 'Diamond Fields Advertiser', 'dfa.co.za', 'Northern Cape', 'Frances Baard District', [
      'Kimberley',
      'Galeshewe',
      'Barkly West',
      'Warrenton',
    ]),
    feedUrl: 'https://www.dfa.co.za/rss/',
    radiusKm: REGIONAL_KM,
    kind: 'regional',
  },

  // ─── Eastern Cape ────────────────────────────────────────────────
  local('grocotts-mail', "Grocott's Mail", 'grocotts.co.za', 'Eastern Cape', 'Sarah Baartman District', [
    'Makhanda',
    'Grahamstown',
    'Joza',
    'Alicedale',
  ]),
  local('talk-of-the-town', 'Talk of the Town', 'talkofthetown.co.za', 'Eastern Cape', 'Sarah Baartman District', [
    'Port Alfred',
    'Kenton-on-Sea',
    'Bathurst',
    'Alexandria',
  ]),
  local('kouga-express', 'Kouga Express', 'kougaexpress.co.za', 'Eastern Cape', 'Sarah Baartman District', [
    'Jeffreys Bay',
    'Humansdorp',
    'St Francis Bay',
    'Hankey',
  ]),
  local('go-express', 'GO! & Express', 'goexpress.co.za', 'Eastern Cape', 'Buffalo City', [
    'East London',
    'Mdantsane',
    'Gonubie',
    'Beacon Bay',
  ]),
  local('the-rep', 'The Rep', 'therep.co.za', 'Eastern Cape', 'Chris Hani District', [
    'Komani',
    'Queenstown',
    'Ezibeleni',
    'Whittlesea',
  ]),

  // ─── Western Cape ────────────────────────────────────────────────
  local('tygerburger', 'TygerBurger', 'tygerburger.co.za', 'Western Cape', 'City of Cape Town', [
    'Bellville',
    'Parow',
    'Durbanville',
    'Goodwood',
    'Brackenfell',
    'Kuils River',
  ]),
  local('city-vision', 'City Vision', 'cityvision.co.za', 'Western Cape', 'City of Cape Town', [
    'Khayelitsha',
    'Gugulethu',
    'Nyanga',
    'Delft',
    'Mfuleni',
  ]),
  local('paarl-post', 'Paarl Post', 'paarlpost.co.za', 'Western Cape', 'Cape Winelands District', [
    'Paarl',
    'Wellington',
    'Mbekweni',
    'Franschhoek',
  ]),
  local('eikestadnuus', 'Eikestadnuus', 'eikestadnuus.co.za', 'Western Cape', 'Cape Winelands District', [
    'Stellenbosch',
    'Kayamandi',
    'Klapmuts',
    'Jamestown',
  ]),
  local(
    'worcester-standard',
    'Worcester Standard',
    'worcesterstandard.co.za',
    'Western Cape',
    'Cape Winelands District',
    ['Worcester', 'Zwelethemba', 'Robertson', 'Montagu', 'Ceres'],
  ),
  local('weslander', 'Weslander', 'weslander.co.za', 'Western Cape', 'West Coast District', [
    'Vredenburg',
    'Saldanha',
    'Langebaan',
    'St Helena Bay',
    'Malmesbury',
  ]),
  local('hermanus-times', 'Hermanus Times', 'hermanustimes.co.za', 'Western Cape', 'Overberg District', [
    'Hermanus',
    'Gansbaai',
    'Stanford',
    'Kleinmond',
    'Onrus',
  ]),
  local('george-herald', 'George Herald', 'georgeherald.com', 'Western Cape', 'Garden Route District', [
    'George',
    'Pacaltsdorp',
    'Thembalethu',
    'Wilderness',
  ]),
  local('knysna-plett-herald', 'Knysna-Plett Herald', 'knysnaplettherald.com', 'Western Cape', 'Garden Route District', [
    'Knysna',
    'Plettenberg Bay',
    'Sedgefield',
    'Kwanokuthula',
  ]),
  local(
    'mossel-bay-advertiser',
    'Mossel Bay Advertiser',
    'mosselbayadvertiser.com',
    'Western Cape',
    'Garden Route District',
    ['Mossel Bay', 'Hartenbos', 'Great Brak River', 'Kwanonqaba'],
  ),
  local('oudtshoorn-courant', 'Oudtshoorn Courant', 'oudtshoorncourant.com', 'Western Cape', 'Garden Route District', [
    'Oudtshoorn',
    'De Rust',
    'Dysselsdorp',
    'Calitzdorp',
  ]),
  local('suid-kaap-forum', 'Suid-Kaap Forum', 'suidkaapforum.com', 'Western Cape', 'Garden Route District', [
    'Riversdale',
    'Still Bay',
    'Albertinia',
    'Heidelberg',
  ]),
  {
    ...local('cape-town-etc', 'Cape Town ETC', 'capetownetc.com', 'Western Cape', 'City of Cape Town', [
      'Cape Town',
      'Sea Point',
      'Woodstock',
      'Mitchells Plain',
    ]),
    radiusKm: REGIONAL_KM,
    kind: 'regional',
  },

  // ─── National ────────────────────────────────────────────────────
  // ⚠️ radiusKm 0 — see NATIONAL_KM. These titles report crime countrywide,
  // so a coverage circle round them would be meaningless; one of their
  // articles matches a precinct only if its OWN place geocodes near it.
  national('citizen', 'The Citizen', 'https://www.citizen.co.za/', 'https://www.citizen.co.za/feed/'),
  national('iol', 'IOL', 'https://www.iol.co.za/', 'https://www.iol.co.za/rss'),
  national(
    'sabc-news',
    'SABC News',
    'https://www.sabcnews.com/',
    'https://www.sabcnews.com/sabcnews/feed/',
  ),
  national('enca', 'eNCA', 'https://www.enca.com/', 'https://www.enca.com/rss.xml'),
  national(
    'daily-maverick',
    'Daily Maverick',
    'https://www.dailymaverick.co.za/',
    'https://www.dailymaverick.co.za/dmrss/',
  ),
  national(
    'the-south-african',
    'The South African',
    'https://www.thesouthafrican.com/',
    'https://www.thesouthafrican.com/feed/',
  ),
  national(
    'maroela-media',
    'Maroela Media',
    'https://maroelamedia.co.za/',
    'https://maroelamedia.co.za/feed/',
  ),

  // ─── The fallback ────────────────────────────────────────────────
  // ⚠️ NOT POLLED. Its feedUrl is a TEMPLATE carrying a {q} placeholder and
  // the nightly poll skips it; it is fetched at MATCH time, per station, when
  // the registry has fewer than four clippings for a precinct — the ordinary
  // case for a rural station no title covers. Results are stored as ordinary
  // NewsArticle rows under this key, so they are enriched, tagged and retained
  // exactly like the rest, and a second query inside 24 hours costs nothing.
  {
    ...national(
      GOOGLE_NEWS_KEY,
      'Google News',
      'https://news.google.com/',
      'https://news.google.com/rss/search?q={q}&hl=en-ZA&gl=ZA&ceid=ZA:en',
    ),
    kind: 'google-news',
  },
];

export const NEWS_SOURCES: readonly NewsSource[] = ROWS.map((r) => ({
  ...r,
  lat: null,
  lng: null,
}));

export const NEWS_SOURCES_BY_KEY: ReadonlyMap<string, NewsSource> = new Map(
  NEWS_SOURCES.map((s) => [s.key, s]),
);

/** Everything the nightly poll fetches — i.e. all of it but the search template. */
export function pollableSources(): NewsSource[] {
  return NEWS_SOURCES.filter((s) => s.kind !== 'google-news');
}

/**
 * A Google News search URL built from the registry's template.
 *
 * ⚠️ THE QUERY IS URL-ENCODED INTO THE TEMPLATE, never concatenated. A South
 * African station name carries spaces and apostrophes ("Grocott's"), and the
 * search itself carries quotes and parentheses; one unencoded `&` would
 * silently truncate the query and return the whole country.
 */
export function googleNewsUrl(query: string, template?: string): string {
  const t =
    template ??
    NEWS_SOURCES_BY_KEY.get(GOOGLE_NEWS_KEY)?.feedUrl ??
    'https://news.google.com/rss/search?q={q}&hl=en-ZA&gl=ZA&ceid=ZA:en';
  return t.replace('{q}', encodeURIComponent(query.trim()));
}
