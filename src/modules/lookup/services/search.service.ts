import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { HtsEntity, EmbeddingService, EmbeddingProviderConfig } from '@hts/core';
import { IntentRule, ScoreAdjustment } from './intent-rules';
import { IntentRuleService } from './intent-rule.service';

type QueryIntent = 'code' | 'text' | 'mixed';

interface SemanticCandidate {
  htsNumber: string;
  similarity: number;
}

interface KeywordCandidate {
  htsNumber: string;
  score: number;
}

interface CandidateEntry {
  htsNumber: string;
  description: string;
  chapter: string;
  indent: number;
  fullDescription?: string[] | null;
}


@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly MAX_LIMIT = 100;
  private readonly RRF_K = 50;
  private readonly GENERIC_LABELS = new Set([
    'other',
    'other:',
    'other.',
    'nesoi',
    'n.e.s.o.i.',
    'n.e.s.i.',
    'not elsewhere specified',
  ]);

  private QUERY_SYNONYMS: Record<string, string[]> = {
    comic: ['comics', 'manga', 'graphic', 'periodical', 'book', 'books'],
    comics: ['comic', 'manga', 'graphic', 'periodical', 'book', 'books'],
    manga: ['comic', 'comics', 'graphic', 'periodical', 'book', 'books'],
    periodical: ['journal', 'magazine', 'serial'],
    journal: ['periodical', 'magazine'],
    magazine: ['periodical', 'journal'],
    book: ['books', 'comic', 'comics', 'periodical', 'journal'],
    books: ['book', 'comic', 'comics', 'periodical', 'journal'],
    transformer: ['transformers'],
    transformers: ['transformer'],
    transfomer: ['transformer', 'transformers'],
    tshirt: ['tshirts', 'shirt', 'shirts', 'tee', 'apparel'],
    tshirts: ['tshirt', 'shirt', 'shirts', 'tee', 'apparel'],
    shirt: ['shirts', 'tshirt', 'tshirts', 'apparel'],
    shirts: ['shirt', 'tshirt', 'tshirts', 'apparel'],
    // HTS vocabulary: "electric" is the standard term in HTS headings
    electronic: ['electric', 'electrical'],
    electronics: ['electric', 'electrical'],
    electrical: ['electric', 'electronic'],
    // Common product descriptions
    // REMOVED: maker/makers → ['machine','apparatus']
    // REASON: 'machine' misdirects coffee makers (ch.85) to ch.84 (machinery).
    //         HOME_APPLIANCE_INTENT intent rule handles appliance queries correctly.
    dryer: ['drying'],
    dryers: ['drying'],
    washer: ['washing'],
    washers: ['washing'],
    freezer: ['freezing', 'refrigerating'],
    freezers: ['freezing', 'refrigerating'],
    cooler: ['cooling', 'refrigerating'],
    heater: ['heating'],
    heaters: ['heating'],
    blender: ['mixing'],
    grinder: ['grinding'],
    grinders: ['grinding'],
    printer: ['printing'],
    printers: ['printing'],
    scanner: ['scanning'],
    computer: ['computers', 'computing', 'data processing'],
    computers: ['computer', 'computing', 'data processing'],
    laptop: ['portable', 'computer', 'computers'],
    laptops: ['portable', 'computer', 'computers'],
    phone: ['telephone', 'telephones'],
    phones: ['telephone', 'telephones'],
    smartphone: ['telephone', 'cellular', 'mobile'],
    smartphones: ['telephone', 'cellular', 'mobile'],
    tv: ['television', 'televisions'],
    television: ['televisions', 'tv'],
    televisions: ['television', 'tv'],
    headphone: ['headphones', 'earphone'],
    headphones: ['headphone', 'earphone'],
    earphone: ['earphones', 'headphone'],
    earphones: ['earphone', 'headphone'],
    speaker: ['speakers', 'loudspeaker'],
    speakers: ['speaker', 'loudspeaker'],
    camera: ['cameras', 'photographic'],
    cameras: ['camera', 'photographic'],
    watch: ['watches', 'timepiece', 'wristwatch'],
    watches: ['watch', 'timepiece', 'wristwatch'],
    shoe: ['shoes', 'footwear'],
    shoes: ['shoe', 'footwear'],
    // "luggage" removed from bag: it was pulling canvas totes into 4202.12 (travel cases).
    // 4202.92 (shopping/sports bags of textile) is the correct heading for tote bags.
    bag: ['bags', 'handbag', 'tote'],
    bags: ['bag', 'handbag', 'tote'],
    tote: ['bag', 'bags', 'shopping'],
    // ── USB / charging cables → chapter 85 (insulated conductors, fitted with connectors) ──
    // "connectors"/"fitted" target the 8544.42 subheading "Fitted with connectors" specifically.
    usb: ['electric', 'electrical', 'conductor', 'connectors', 'fitted'],
    charging: ['electric', 'electrical', 'power', 'connectors'],
    charger: ['electric', 'electrical', 'power', 'connectors', 'fitted'],
    chargers: ['electric', 'electrical', 'power', 'connectors', 'fitted'],
    cable: ['cables', 'conductor', 'wire', 'connectors'],
    cables: ['cable', 'conductor', 'wire'],
    // ── Pokémon / trading cards → chapter 95 (playing cards / games) ───────────────────
    pokemon: ['playing', 'card', 'game', 'trading'],
    trading: ['card', 'game', 'playing'],
    card: ['cards', 'playing', 'game'],
    cards: ['card', 'playing', 'game'],
    // ── Plush / stuffed toys → chapter 95 ───────────────────────────────────────────────
    plush: ['stuffed', 'toy', 'toys', 'dolls'],
    stuffed: ['plush', 'toy', 'toys'],
    toy: ['toys', 'plaything', 'dolls'],
    toys: ['toy', 'plaything', 'dolls'],
    // ── Vinyl sticker / printed decorative items → chapter 49 (printed matter 4911.91) ─────
    // "adhesive"/"label"/"self-adhesive" point to 4821 (paper labels) — removed.
    // "pictorial"/"picture"/"design" target 4911.91 "Printed pictures, designs and photographs".
    sticker: ['printed', 'pictorial', 'picture', 'design'],
    stickers: ['printed', 'pictorial', 'picture', 'design'],
    vinyl: ['printed', 'pictorial', 'design'],
    // ── Keychain / metal accessories → chapter 73 (7326 articles of iron/steel) ──────────
    // REMOVED: keychain → ['fob','wire','metal','accessory'] (keychains key was never present)
    // REASON: 'wire'/'metal'/'accessory' are too generic; they fight with KEYCHAIN_METAL_INTENT
    //         and KEYCHAIN_ACRYLIC_INTENT rules which inject candidates (7326.20, 7326.90,
    //         3926.40) directly. Synonym audit showed 'metal keychain' is found correctly
    //         WITHOUT these synonyms (+1 hit@10 when synonyms are disabled).
    // ── Laptop sleeve → chapter 42 (bags/cases, not apparel) ────────────────────────────
    sleeve: ['bag', 'case', 'holder', 'protective'],
    sleeves: ['bag', 'case', 'holder', 'protective'],
    // ── Hair scrunchie → 6117.80 (other knitted clothing accessories: ponytail holders) ──
    // "hair" removed — "hair" matches "hair-nets" in chapter 65 (headgear/hats).
    // "ponytail" and "holders" target 6117.80.30.10 / 6117.80.85.00 descriptions directly.
    scrunchie: ['elastic', 'knitted', 'textile', 'ponytail', 'holders', 'headband'],
    scrunchies: ['elastic', 'knitted', 'textile', 'ponytail', 'holders', 'headband'],
    // ── Bottle opener / can opener → chapter 82 (8210 hand-operated mechanical appliances) ──
    // "mechanical" and "appliance"/"appliances" target 8210's description directly:
    // "Hand-operated mechanical appliances, weighing 10 kg or less, used in the preparation..."
    opener: ['mechanical', 'appliance', 'appliances', 'hand', 'operated'],
    openers: ['mechanical', 'appliance', 'appliances', 'hand', 'operated'],
    // ── Costume jewelry / necklace → chapter 71 (imitation jewelry) ─────────────────────
    necklace: ['jewelry', 'jewellery', 'imitation', 'ornament'],
    necklaces: ['jewelry', 'jewellery', 'imitation'],
    jewelry: ['jewellery', 'imitation', 'ornament'],
    jewellery: ['jewelry', 'imitation', 'ornament'],
    costume: ['imitation', 'jewelry', 'jewellery'],
    // ── Baseball cap / headwear → chapter 65 ────────────────────────────────────────────
    cap: ['hat', 'headwear', 'headgear', 'hats'],
    caps: ['hat', 'headwear', 'headgear', 'hats'],
    hat: ['cap', 'headwear', 'headgear'],
    hats: ['cap', 'headwear', 'headgear'],
    baseball: ['headgear'],  // 'sport'/'game' removed — pulled ch.95 baseballs for "baseball cap"
    // ── Wallet / purse → chapter 42 ──────────────────────────────────────────────────────
    wallet: ['purse', 'leather', 'pocketbook'],
    wallets: ['purse', 'leather', 'pocketbook'],
    purse: ['wallet', 'leather', 'handbag'],
    // ── Scarf → chapter 61/62 ─────────────────────────────────────────────────────────────
    scarf: ['shawl', 'apparel', 'knit', 'woven', 'muffler'],
    scarves: ['shawl', 'apparel', 'knit', 'woven'],
    // ── Socks / hosiery → chapter 61 ─────────────────────────────────────────────────────
    sock: ['socks', 'hosiery', 'knit'],
    socks: ['sock', 'hosiery', 'knit'],
    // ── Dice / game accessories → chapter 95 ─────────────────────────────────────────────
    dice: ['game', 'gaming', 'play', 'toys'],
    die: ['dice', 'game', 'play'],
    // ── Notebook / stationery → chapter 48 ───────────────────────────────────────────────
    notebook: ['book', 'stationery', 'paper', 'journal'],
    notebooks: ['book', 'stationery', 'paper'],
    // ── Silicone / plastic articles → chapter 39 ─────────────────────────────────────────
    silicone: ['plastic', 'rubber', 'elastomeric'],
    // ── Stand / holder (non-audio) ────────────────────────────────────────────────────────
    stand: ['holder', 'support', 'mount'],
    // ── Canvas → textile bags (4202.92) not suitcases (4202.12) ─────────────────────────
    // "outer" and "surface" appear ONLY in the 4202.92 subheading text:
    // "With outer surface of sheeting of plastics or of textile materials"
    // They do NOT appear in 4202.12 subheading, so they disambiguate the two subheadings.
    canvas: ['woven', 'cotton', 'textile', 'outer', 'surface'],
    // ── Cotton socks/hosiery → 6115.95 (cotton) not 6115.10 (support/compression) ────────
    hosiery: ['knit', 'knitted', 'socks', 'stockings'],
    knit: ['knitted', 'hosiery', 'textile'],
    knitted: ['knit', 'hosiery', 'textile'],
    // ── Earbuds / earphones → chapter 85 (8518.30 headphones/earphones) ─────────────────
    earbud: ['earphone', 'earphones', 'headphone', 'headphones'],
    earbuds: ['earbud', 'earphone', 'earphones', 'headphone', 'headphones'],
    // ── Wireless / Bluetooth → cordless only ──────────────────────────────────────────────
    // REMOVED: 'radio' from wireless synonyms
    // REASON: 'radio' pulls in broadcasting/transmitter equipment (8525/8527) for queries
    //         like "wireless router WiFi" and "bluetooth wireless earbuds". Intent rules
    //         (EARBUD_INTENT) already handle those correctly.
    // KEPT: 'cordless' — audit showed no harm on eval set (neutral for both affected queries).
    //       'cordless' maps to cordless-telephone/appliance HTS text which is relevant for
    //       wireless appliance queries without pulling in broadcasting equipment.
    wireless: ['cordless'],
    bluetooth: ['wireless', 'cordless'],
    // ── Water bottle / flask → chapter 73 (7323 table/kitchen/household articles) ─────────
    bottle: ['container', 'flask', 'vessel', 'thermos'],
    bottles: ['bottle', 'container', 'flask', 'vessel'],
    flask: ['bottle', 'vessel', 'thermos'],
    // ── Mug / cup / drinkware → chapter 69/70 (ceramic/glass cups) ──────────────
    mug: ['cup', 'cups', 'drinking', 'tableware', 'ceramic'],
    mugs: ['mug', 'cup', 'cups', 'drinking', 'tableware'],
    cup: ['cups', 'mug', 'drinking', 'tableware'],
    cups: ['cup', 'mug', 'drinking', 'tableware'],
    // ── Yoga mat / exercise mat → chapter 39/40 (rubber/plastic) ─────────────────
    yoga: ['exercise', 'fitness', 'rubber'],
    mat: ['mats', 'padding', 'floor'],
    mats: ['mat', 'padding', 'floor'],
    // ── Frying pan / cookware → chapter 73/76 ─────────────────────────────────────
    frying: ['cooking', 'cookware', 'kitchen'],
    pan: ['cookware', 'skillet', 'saucepan', 'kitchen'],
    pans: ['pan', 'cookware', 'skillet', 'kitchen'],
    skillet: ['pan', 'cookware', 'cooking'],
    cookware: ['cooking', 'kitchen', 'pan', 'pots'],
    pot: ['pots', 'cookware', 'cooking'],
    pots: ['pot', 'cookware', 'cooking'],
    // ── Dumbbell / barbell / weights → chapter 95 ────────────────────────────────
    dumbbell: ['weight', 'weights', 'fitness', 'exercise'],
    dumbbells: ['dumbbell', 'weight', 'weights', 'fitness'],
    barbell: ['weight', 'weights', 'fitness', 'exercise'],
    barbells: ['barbell', 'weight', 'weights'],
    // ── Desk lamp / floor lamp → chapter 94 (luminaires 9405) ─────────────────────
    lamp: ['lamps', 'lighting', 'luminaire', 'light'],
    lamps: ['lamp', 'lighting', 'luminaire'],
    // ── Hair dryer → 8516.31 ─────────────────────────────────────────────────────
    // Note: 'dryer'→'drying' kept for washers/dryers context; HAIR_DRYER_INTENT handles disambiguation
    hair: ['hair'],  // Keep hair as-is; injection rule handles 8516.31 directly
    // ── Garden hose / irrigation → chapter 39 (3917 plastic tubing) ───────────────
    hose: ['tubing', 'tube', 'pipe'],
    garden: ['outdoor', 'irrigation', 'lawn'],
    // ── Throw pillow / cushion → chapter 94 (9404.90) ────────────────────────────
    pillow: ['cushion', 'pillows', 'cushions'],
    pillows: ['pillow', 'cushion', 'cushions'],
    cushion: ['pillow', 'pillows', 'cushions'],
    cushions: ['cushion', 'pillow', 'pillows'],
    throw: ['cushion', 'decorative'],  // "throw pillow" → decorative cushion context
    // ── Picture frame → chapter 39/70 ────────────────────────────────────────────
    frame: ['frames', 'display', 'decorative'],
    frames: ['frame', 'display', 'decorative'],
    // ── Candle holder / candlestick → chapter 94 ──────────────────────────────────
    candleholder: ['candle', 'holder', 'candlestick'],
    candlestick: ['candle', 'holder'],
    // ── Backpack / luggage / handbag / belt → chapter 42 ──────────────────────
    backpack: ['rucksack', 'knapsack', 'daypack', 'bag'],
    backpacks: ['backpack', 'rucksack', 'knapsack', 'bag'],
    rucksack: ['backpack', 'knapsack', 'bag'],
    luggage: ['suitcase', 'travel', 'baggage', 'trolley'],
    suitcase: ['luggage', 'travel', 'baggage'],
    suitcases: ['suitcase', 'luggage', 'travel'],
    handbag: ['purse', 'bag', 'tote', 'leather'],
    handbags: ['handbag', 'purse', 'bag'],
    belt: ['belts', 'waistband', 'leather'],
    belts: ['belt', 'waistband'],
    // ── Carpet / rug → chapter 57 ─────────────────────────────────────────────
    carpet: ['carpets', 'rug', 'rugs', 'floor', 'textile'],
    carpets: ['carpet', 'rug', 'rugs', 'floor'],
    rug: ['rugs', 'carpet', 'carpets', 'floor', 'textile'],
    rugs: ['rug', 'carpet', 'carpets', 'floor'],
    // ── Jacket / coat → chapter 61/62 ─────────────────────────────────────────
    jacket: ['jackets', 'coat', 'coats', 'outerwear', 'apparel'],
    jackets: ['jacket', 'coat', 'coats', 'outerwear'],
    coat: ['coats', 'jacket', 'jackets', 'outerwear', 'apparel'],
    coats: ['coat', 'jacket', 'jackets', 'outerwear'],
    // ── Dress / skirt → chapter 61/62 ─────────────────────────────────────────
    dress: ['dresses', 'skirt', 'skirts', 'apparel', 'woven'],
    dresses: ['dress', 'skirt', 'skirts', 'apparel'],
    skirt: ['skirts', 'dress', 'apparel', 'woven'],
    skirts: ['skirt', 'dress', 'apparel'],
    // ── Pants / jeans / trousers → chapter 61/62 ──────────────────────────────
    pants: ['trousers', 'jeans', 'apparel', 'bottoms'],
    jeans: ['trousers', 'pants', 'denim', 'apparel'],
    trousers: ['pants', 'jeans', 'apparel'],
    // ── Hoodie / sweater / sweatshirt → chapter 61 ────────────────────────────
    hoodie: ['hoodies', 'sweatshirt', 'pullover', 'sweater', 'knit', 'apparel'],
    hoodies: ['hoodie', 'sweatshirt', 'pullover', 'apparel'],
    sweatshirt: ['hoodie', 'sweater', 'pullover', 'apparel'],
    sweater: ['knitwear', 'pullover', 'knit', 'apparel'],
    sweaters: ['sweater', 'knitwear', 'pullover', 'apparel'],
    pullover: ['sweater', 'knitwear', 'apparel'],
    // ── Swimwear → chapter 61/62 ──────────────────────────────────────────────
    swimwear: ['swimsuit', 'bathing', 'swim', 'apparel'],
    swimsuit: ['swimwear', 'bathing', 'swim', 'apparel'],
    swimsuits: ['swimsuit', 'swimwear', 'bathing', 'apparel'],
    bikini: ['swimwear', 'swimsuit', 'bathing', 'swim'],
    // ── Underwear / bra → chapter 61 ─────────────────────────────────────────
    underwear: ['underpants', 'briefs', 'boxers', 'knit', 'apparel'],
    bra: ['bras', 'underwear', 'apparel', 'knit'],
    bras: ['bra', 'underwear'],
    // ── Gloves / mittens → chapter 61/62 ──────────────────────────────────────
    glove: ['gloves', 'mitten', 'mittens', 'knitwear'],
    gloves: ['glove', 'mitten', 'mittens', 'knitwear', 'apparel'],
    // ── Towel / blanket / curtain → chapter 63 ────────────────────────────────
    towel: ['towels', 'terry', 'bath', 'cotton', 'textile'],
    towels: ['towel', 'terry', 'bath', 'cotton'],
    blanket: ['blankets', 'quilt', 'textile'],
    blankets: ['blanket', 'quilt', 'textile'],
    curtain: ['curtains', 'drape', 'drapes', 'window', 'textile'],
    curtains: ['curtain', 'drape', 'drapes', 'window'],
    drape: ['drapes', 'curtain', 'curtains', 'window'],
    drapes: ['drape', 'curtain', 'curtains'],
    // ── Umbrella → chapter 66 ─────────────────────────────────────────────────
    umbrella: ['umbrellas', 'parasol', 'rain'],
    umbrellas: ['umbrella', 'parasol', 'rain'],
    // ── Plate / bowl / vase → chapter 69 (ceramic) ────────────────────────────
    plate: ['plates', 'dish', 'dishes', 'tableware', 'ceramic'],
    plates: ['plate', 'dish', 'dishes', 'tableware'],
    bowl: ['bowls', 'dish', 'dishes', 'tableware', 'ceramic'],
    bowls: ['bowl', 'dish', 'dishes', 'tableware'],
    dish: ['dishes', 'plate', 'bowl', 'tableware'],
    dishes: ['dish', 'plate', 'bowl', 'tableware'],
    vase: ['vases', 'ceramic', 'porcelain', 'pottery', 'decorative'],
    vases: ['vase', 'ceramic', 'porcelain', 'pottery'],
    // ── Glassware / mirror → chapter 70 ──────────────────────────────────────
    glassware: ['glass', 'glasses', 'drinking', 'tableware'],
    mirror: ['mirrors', 'glass', 'reflective'],
    mirrors: ['mirror', 'glass', 'reflective'],
    // ── Knife / fork / spoon / cutlery → chapter 82 ──────────────────────────
    knife: ['knives', 'blade', 'cutlery'],
    knives: ['knife', 'blade', 'cutlery'],
    fork: ['forks', 'cutlery', 'utensil'],
    forks: ['fork', 'cutlery', 'utensil'],
    spoon: ['spoons', 'utensil', 'cutlery'],
    spoons: ['spoon', 'utensil', 'cutlery'],
    cutlery: ['knife', 'fork', 'spoon', 'utensil'],
    utensil: ['utensils', 'cutlery'],
    utensils: ['utensil', 'cutlery'],
    // ── Padlock / lock → chapter 83 ───────────────────────────────────────────
    padlock: ['padlocks', 'lock', 'locks'],
    padlocks: ['padlock', 'lock'],
    // ── Vacuum cleaner → chapter 85 ───────────────────────────────────────────
    vacuum: ['vacuums', 'suction', 'cleaner'],
    vacuums: ['vacuum', 'suction'],
    // ── Electric shaver / trimmer → chapter 85 ────────────────────────────────
    shaver: ['shavers', 'razor', 'electric', 'trimmer'],
    shavers: ['shaver', 'razor', 'electric'],
    razor: ['razors', 'shaver', 'shavers'],
    razors: ['razor', 'shaver'],
    trimmer: ['trimmers', 'shaver', 'clipper'],
    trimmers: ['trimmer', 'shaver'],
    // ── Bicycle → chapter 87 ─────────────────────────────────────────────────
    bicycle: ['bicycles', 'bike', 'bikes', 'cycle'],
    bicycles: ['bicycle', 'bike', 'bikes'],
    bike: ['bikes', 'bicycle', 'bicycles', 'cycle'],
    bikes: ['bike', 'bicycle', 'bicycles'],
    // ── Sunglasses → chapter 90 ──────────────────────────────────────────────
    sunglasses: ['sunglass', 'eyewear', 'spectacles', 'optical'],
    sunglass: ['sunglasses', 'eyewear'],
    // ── Musical instruments → chapter 92 ─────────────────────────────────────
    guitar: ['guitars', 'stringed', 'musical', 'instrument'],
    guitars: ['guitar', 'stringed', 'musical'],
    piano: ['pianos', 'keyboard', 'musical', 'instrument'],
    violin: ['violins', 'stringed', 'musical'],
    drum: ['drums', 'percussion', 'musical'],
    drums: ['drum', 'percussion', 'musical'],
    // ── Pen / pencil → chapter 96 ─────────────────────────────────────────────
    pen: ['pens', 'ballpoint', 'writing', 'stationery'],
    pens: ['pen', 'ballpoint', 'writing'],
    pencil: ['pencils', 'writing', 'stationery'],
    pencils: ['pencil', 'writing', 'stationery'],
    ballpoint: ['pen', 'pens', 'writing'],
    // ── Toothbrush → chapter 96 ───────────────────────────────────────────────
    toothbrush: ['toothbrushes', 'brush', 'dental', 'oral'],
    toothbrushes: ['toothbrush', 'brush', 'dental', 'oral'],
    // ── Soap → chapter 34 ─────────────────────────────────────────────────────
    soap: ['soaps', 'detergent', 'cleansing', 'washing'],
    soaps: ['soap', 'detergent', 'cleansing'],
    // ── Perfume / fragrance → chapter 33 ─────────────────────────────────────
    perfume: ['perfumes', 'fragrance', 'cologne', 'toilet'],
    perfumes: ['perfume', 'fragrance', 'cologne'],
    cologne: ['perfume', 'fragrance', 'toilet'],
    fragrance: ['perfume', 'cologne', 'scent'],
    // ── Shampoo / conditioner → chapter 33 ───────────────────────────────────
    shampoo: ['shampoos', 'conditioner', 'cleansing'],
    shampoos: ['shampoo', 'conditioner'],
    conditioner: ['shampoo'],
    // ── Fresh flowers / cut flowers → chapter 06 ──────────────────────────────
    flower: ['flowers', 'bloom', 'floral', 'bouquet'],
    flowers: ['flower', 'bloom', 'floral', 'bouquet'],
    rose: ['roses', 'floral', 'flower'],
    roses: ['rose', 'floral', 'flowers'],
    orchid: ['orchids', 'floral', 'flower'],
    orchids: ['orchid', 'floral', 'flowers'],
    tulip: ['tulips', 'floral', 'flower'],
    tulips: ['tulip', 'floral', 'flowers'],
    lily: ['lilies', 'floral', 'flower'],
    lilies: ['lily', 'floral', 'flowers'],
    carnation: ['carnations', 'floral', 'flower'],
    carnations: ['carnation', 'floral', 'flowers'],
    bouquet: ['flowers', 'floral', 'arrangement'],
    // ── Indoor plants / succulents → chapter 06 ───────────────────────────────
    plant: ['plants', 'botanical', 'indoor', 'live'],
    plants: ['plant', 'botanical', 'indoor'],
    succulent: ['succulents', 'plant', 'plants'],
    succulents: ['succulent', 'plant', 'plants'],
    bonsai: ['tree', 'plant', 'miniature'],
    // ── Tea → chapter 09 ─────────────────────────────────────────────────────
    tea: ['teas', 'herbal', 'infusion'],
    teas: ['tea', 'herbal', 'infusion'],
    matcha: ['tea', 'powdered', 'green'],
    chamomile: ['tea', 'herbal', 'infusion'],
    // ── Chocolate / candy → chapter 17/18 ────────────────────────────────────
    chocolate: ['chocolates', 'cocoa', 'cacao', 'confection'],
    chocolates: ['chocolate', 'cocoa', 'confection'],
    candy: ['candies', 'confection', 'sweet', 'sweets'],
    candies: ['candy', 'confection', 'sweet'],
    gummy: ['gummies', 'candy', 'confection', 'gelatin'],
    gummies: ['gummy', 'candy', 'confection'],
    // ── Pasta / noodles → chapter 19 ─────────────────────────────────────────
    pasta: ['noodles', 'spaghetti', 'penne', 'macaroni', 'fettuccine'],
    noodle: ['noodles', 'pasta', 'ramen', 'vermicelli'],
    noodles: ['noodle', 'pasta', 'ramen'],
    ramen: ['noodles', 'pasta', 'soup'],
    spaghetti: ['pasta', 'noodles'],
    // ── Wine → chapter 22 ─────────────────────────────────────────────────────
    wine: ['wines', 'vintage', 'vino'],
    wines: ['wine', 'vintage'],
    champagne: ['wine', 'prosecco', 'sparkling'],
    prosecco: ['wine', 'champagne', 'sparkling'],
    // ── Beer → chapter 22 ─────────────────────────────────────────────────────
    beer: ['beers', 'ale', 'lager', 'malt'],
    beers: ['beer', 'ale', 'lager'],
    ale: ['beer', 'beers', 'lager'],
    lager: ['beer', 'beers', 'ale'],
    // ── Honey → chapter 04 ────────────────────────────────────────────────────
    honey: ['honeys', 'natural', 'beeswax'],
    // ── Nuts → chapter 08/12 ─────────────────────────────────────────────────
    almond: ['almonds', 'nut', 'nuts'],
    almonds: ['almond', 'nuts'],
    cashew: ['cashews', 'nut', 'nuts'],
    cashews: ['cashew', 'nuts'],
    walnut: ['walnuts', 'nut', 'nuts'],
    walnuts: ['walnut', 'nuts'],
    peanut: ['peanuts', 'nut', 'nuts', 'groundnut'],
    peanuts: ['peanut', 'nuts', 'groundnut'],
    pistachio: ['pistachios', 'nut', 'nuts'],
    pistachios: ['pistachio', 'nuts'],
    nut: ['nuts', 'kernels'],
    nuts: ['nut', 'kernels'],
    // ── Chopping board → chapter 44 ───────────────────────────────────────────
    chopping: ['cutting', 'board', 'kitchen'],
    // ── Tissue / paper towel → chapter 48 ────────────────────────────────────
    tissue: ['tissues', 'facial', 'kleenex', 'paper'],
    tissues: ['tissue', 'facial', 'paper'],
    // ── Athletic footwear / sneakers → chapter 64 ────────────────────────────
    sneaker: ['sneakers', 'trainer', 'athletic', 'footwear'],
    sneakers: ['sneaker', 'trainer', 'athletic', 'footwear'],
    trainer: ['trainers', 'sneaker', 'athletic', 'footwear'],
    trainers: ['trainer', 'sneaker', 'athletic', 'footwear'],
    // ── Boots → chapter 64 ────────────────────────────────────────────────────
    boot: ['boots', 'ankle', 'footwear'],
    boots: ['boot', 'ankle', 'footwear'],
    // ── Sandals / flip flops → chapter 64 ────────────────────────────────────
    sandal: ['sandals', 'flip', 'flops', 'footwear'],
    sandals: ['sandal', 'flip', 'flops', 'footwear'],
    flipflop: ['sandal', 'sandals', 'footwear'],
    flipflops: ['sandal', 'sandals', 'footwear'],
    slipper: ['slippers', 'moccasin', 'footwear'],
    slippers: ['slipper', 'moccasin', 'footwear'],
    // ── Aluminum foil → chapter 76 ────────────────────────────────────────────
    foil: ['aluminum', 'aluminium', 'kitchen', 'wrap'],
    // ── Scissors → chapter 82 ─────────────────────────────────────────────────
    scissor: ['scissors', 'shears', 'cutting'],
    scissors: ['scissor', 'shears', 'cutting'],
    // ── Microwave → chapter 85 ────────────────────────────────────────────────
    microwave: ['microwaves', 'oven', 'appliance'],
    microwaves: ['microwave', 'oven', 'appliance'],
    // ── Drone → chapter 88 ────────────────────────────────────────────────────
    drone: ['drones', 'quadcopter', 'uav', 'unmanned'],
    drones: ['drone', 'quadcopter', 'uav'],
    quadcopter: ['drone', 'drones', 'uav'],
    // ── Router / WiFi → chapter 85 ────────────────────────────────────────────
    router: ['routers', 'wifi', 'wireless', 'networking'],
    routers: ['router', 'wifi', 'wireless'],
    // ── Stroller → chapter 87 ─────────────────────────────────────────────────
    stroller: ['strollers', 'pram', 'prams', 'buggy', 'carriage'],
    strollers: ['stroller', 'pram', 'carriage'],
    pram: ['prams', 'stroller', 'buggy', 'carriage'],
    // ── Mattress → chapter 94 ─────────────────────────────────────────────────
    mattress: ['mattresses', 'bedding', 'spring', 'foam'],
    mattresses: ['mattress', 'bedding', 'foam'],
    // ── Fishing → chapter 95 ─────────────────────────────────────────────────
    fishing: ['fish', 'angling', 'tackle'],
    // ── Skateboard / longboard → chapter 95 ──────────────────────────────────
    skateboard: ['skateboards', 'longboard', 'skating', 'skate'],
    skateboards: ['skateboard', 'longboard'],
    longboard: ['longboards', 'skateboard', 'skating'],
    // ── Camping tent → chapter 63 ─────────────────────────────────────────────
    tent: ['tents', 'shelter', 'camping', 'outdoor'],
    tents: ['tent', 'shelter', 'camping'],
    // ── Board game / puzzle → chapter 95 ─────────────────────────────────────
    puzzle: ['puzzles', 'jigsaw', 'game', 'toy'],
    puzzles: ['puzzle', 'jigsaw', 'game'],
    jigsaw: ['puzzle', 'puzzles', 'game'],
    // ── Cosmetics → chapter 33 ────────────────────────────────────────────────
    lipstick: ['lipsticks', 'lip gloss', 'lip color', 'cosmetic'],
    mascara: ['mascaras', 'eyelash', 'cosmetic'],
    eyeshadow: ['eye shadow', 'cosmetic', 'makeup'],
    eyeliner: ['eye liner', 'cosmetic', 'makeup'],
    deodorant: ['deodorants', 'antiperspirant', 'antiperspirants'],
    antiperspirant: ['antiperspirants', 'deodorant'],
    sunscreen: ['sunscreens', 'sunblock', 'spf', 'sun protection'],
    sunblock: ['sunscreen', 'spf', 'sun protection'],
    moisturizer: ['moisturizers', 'lotion', 'cream', 'skincare'],
    moisturizers: ['moisturizer', 'lotion', 'cream'],
    serum: ['serums', 'skincare', 'face care'],
    serums: ['serum', 'skincare'],
    lotion: ['lotions', 'moisturizer', 'cream'],
    lotions: ['lotion', 'moisturizer', 'cream'],
    // ── Athletic wear / leggings → chapter 61 ────────────────────────────────
    leggings: ['legging', 'tights', 'knit', 'apparel'],
    legging: ['leggings', 'tights', 'knit', 'apparel'],
    tights: ['leggings', 'stockings', 'hosiery', 'knit'],
    tracksuit: ['tracksuits', 'athletic wear', 'sportswear', 'sweats'],
    tracksuits: ['tracksuit', 'athletic wear', 'sportswear'],
    activewear: ['sportswear', 'athletic', 'apparel'],
    sportswear: ['activewear', 'athletic', 'apparel'],
    // ── Candle → chapter 34 ───────────────────────────────────────────────────
    candle: ['candles', 'taper', 'wax', 'wick'],
    candles: ['candle', 'taper', 'wax'],
    // ── Essential oil / aromatherapy → chapter 33 ────────────────────────────
    lavender: ['lavender oil', 'essential oil', 'floral'],
    aromatherapy: ['essential oil', 'diffuser', 'scent'],
    // ── Baby products ─────────────────────────────────────────────────────────
    diaper: ['diapers', 'nappy', 'nappies', 'infant'],
    diapers: ['diaper', 'nappy', 'nappies', 'infant'],
    nappy: ['nappies', 'diaper', 'diapers'],
    nappies: ['nappy', 'diaper', 'diapers'],
    // ── Pet food → chapter 23 ─────────────────────────────────────────────────
    kibble: ['pet food', 'dog food', 'cat food', 'pellet'],
    // ── Smartwatch / fitness tracker → chapter 85 ────────────────────────────
    smartwatch: ['smartwatches', 'wearable', 'fitness tracker'],
    smartwatches: ['smartwatch', 'wearable', 'fitness tracker'],
    fitbit: ['fitness tracker', 'wearable', 'smartwatch'],
    wearable: ['smartwatch', 'fitness tracker'],
    // ── Tripod / selfie stick → chapter 96 ───────────────────────────────────
    tripod: ['tripods', 'camera stand', 'monopod'],
    tripods: ['tripod', 'camera stand'],
    selfie: ['selfie stick', 'camera', 'monopod'],
    // ── Gaming console → chapter 95 ──────────────────────────────────────────
    playstation: ['console', 'gaming', 'video game'],
    xbox: ['console', 'gaming', 'video game'],
    nintendo: ['console', 'gaming', 'switch'],
    console: ['consoles', 'gaming', 'video game'],
    // ── Beanie / hat → chapter 65 ─────────────────────────────────────────────
    beanie: ['beanies', 'knit hat', 'winter hat', 'headwear'],
    beanies: ['beanie', 'knit hat', 'winter hat'],
    fedora: ['fedoras', 'hat', 'headwear'],
    // ── Helmet → chapter 65 ───────────────────────────────────────────────────
    helmet: ['helmets', 'protective', 'headgear'],
    helmets: ['helmet', 'protective', 'headgear'],
    // ── Supplement / vitamin → chapter 29/30 ─────────────────────────────────
    supplement: ['supplements', 'vitamin', 'dietary', 'nutritional'],
    supplements: ['supplement', 'vitamin', 'dietary'],
    vitamin: ['vitamins', 'supplement', 'nutritional'],
    vitamins: ['vitamin', 'supplement'],
    // ── Speaker → chapter 85 ─────────────────────────────────────────────────
    soundbar: ['speaker', 'speakers', 'audio'],
    subwoofer: ['speaker', 'bass', 'audio'],
    // ── Microphone → chapter 85 ───────────────────────────────────────────────
    microphone: ['microphones', 'mic', 'recording', 'audio'],
    microphones: ['microphone', 'mic', 'recording'],
    // ── Computer keyboard → chapter 84 ───────────────────────────────────────
    keyboard: ['keyboards', 'typing', 'input device'],
    keyboards: ['keyboard', 'typing', 'input'],
    // ── Spices / seasonings → chapter 09 ─────────────────────────────────────
    spice: ['spices', 'seasoning', 'seasonings', 'herb'],
    spices: ['spice', 'seasoning', 'herb'],
    pepper: ['peppers', 'spice', 'seasoning', 'peppercorn'],
    cinnamon: ['spice', 'seasoning'],
    cumin: ['spice', 'seasoning'],
    turmeric: ['spice', 'seasoning', 'curry'],
    paprika: ['spice', 'seasoning'],
    // ── Ice cream → chapter 21 ────────────────────────────────────────────────
    icecream: ['ice cream', 'sorbet', 'gelato', 'frozen'],
    sorbet: ['ice cream', 'frozen', 'dessert'],
    // ── Candle holder decor → chapter 94 ─────────────────────────────────────
    tealight: ['tea light', 'candle', 'votive'],
    // ── Sleeping bag → chapter 94 ─────────────────────────────────────────────
    // sleeping + bag tokens handled by SLEEPING_BAG_INTENT
    // ── Wristwatch (analog) → chapter 91 ──────────────────────────────────────
    wristwatch: ['watch', 'watches', 'wristband', 'timepiece'],
    wristwatches: ['wristwatch', 'watch', 'watches'],
    // ── Nail polish → chapter 33 ──────────────────────────────────────────────
    nailpolish: ['nail polish', 'nail varnish', 'nail lacquer', 'cosmetic'],
    // ── Power bank → chapter 85 ───────────────────────────────────────────────
    powerbank: ['power bank', 'portable charger', 'battery pack'],
    // ── Extension cord → chapter 85 ───────────────────────────────────────────
    extension: ['extension cord', 'power strip', 'surge', 'outlet'],
    // ── Air purifier → chapter 84 ─────────────────────────────────────────────
    purifier: ['air purifier', 'hepa', 'filter', 'cleaner'],
    // ── Olive oil → chapter 15 ────────────────────────────────────────────────
    olive: ['olives', 'oil', 'virgin', 'extra'],
    // ── Fresh vegetables → chapter 7 ──────────────────────────────────────────
    broccoli: ['vegetable', 'fresh', 'produce', 'cruciferous'],
    carrot: ['carrots', 'vegetable', 'fresh', 'produce', 'root'],
    potato: ['potatoes', 'vegetable', 'fresh', 'produce', 'root'],
    onion: ['onions', 'vegetable', 'fresh', 'produce'],
    tomato: ['tomatoes', 'vegetable', 'fresh', 'produce'],
    spinach: ['leafy', 'vegetable', 'greens', 'produce'],
    lettuce: ['salad', 'leafy', 'vegetable', 'greens', 'produce'],
    mushroom: ['mushrooms', 'fungi', 'vegetable', 'fresh', 'produce'],
    cucumber: ['cucumbers', 'vegetable', 'fresh', 'produce'],
    corn: ['maize', 'sweetcorn', 'vegetable', 'fresh', 'produce'],
    garlic: ['bulb', 'vegetable', 'fresh', 'produce'],
    ginger: ['root', 'spice', 'fresh', 'produce'],
    capsicum: ['bell pepper', 'sweet pepper', 'vegetable', 'fresh', 'produce'],
    asparagus: ['vegetable', 'fresh', 'produce'],
    zucchini: ['courgette', 'vegetable', 'fresh', 'produce'],
    eggplant: ['aubergine', 'vegetable', 'fresh', 'produce'],
    celery: ['vegetable', 'fresh', 'produce'],
    cabbage: ['cabbages', 'vegetable', 'fresh', 'produce', 'leafy'],
    cauliflower: ['vegetable', 'fresh', 'produce', 'cruciferous'],
    pumpkin: ['squash', 'gourd', 'vegetable', 'fresh', 'produce'],
    // ── Fresh fruits → chapter 8 ──────────────────────────────────────────────
    apple: ['apples', 'fruit', 'fresh', 'produce'],
    banana: ['bananas', 'fruit', 'fresh', 'produce', 'tropical'],
    orange: ['oranges', 'citrus', 'fruit', 'fresh', 'produce'],
    strawberry: ['strawberries', 'berry', 'fruit', 'fresh', 'produce'],
    blueberry: ['blueberries', 'berry', 'fruit', 'fresh', 'produce'],
    grape: ['grapes', 'fruit', 'fresh', 'produce'],
    mango: ['mangoes', 'fruit', 'fresh', 'produce', 'tropical'],
    avocado: ['avocados', 'fruit', 'fresh', 'produce'],
    lemon: ['lemons', 'citrus', 'fruit', 'fresh', 'produce'],
    lime: ['limes', 'citrus', 'fruit', 'fresh', 'produce'],
    peach: ['peaches', 'fruit', 'fresh', 'produce'],
    pear: ['pears', 'fruit', 'fresh', 'produce'],
    watermelon: ['melon', 'fruit', 'fresh', 'produce'],
    pineapple: ['pineapples', 'fruit', 'fresh', 'produce', 'tropical'],
    cherry: ['cherries', 'fruit', 'fresh', 'produce', 'berry'],
    kiwi: ['kiwifruit', 'fruit', 'fresh', 'produce'],
    papaya: ['papayas', 'fruit', 'fresh', 'produce', 'tropical'],
    coconut: ['coconuts', 'fruit', 'fresh', 'tropical'],
    plum: ['plums', 'fruit', 'fresh', 'produce'],
    // ── Dairy → chapter 4 ─────────────────────────────────────────────────────
    milk: ['dairy', 'whole milk', 'skim', 'fresh', 'beverage'],
    cheese: ['cheeses', 'dairy', 'cheddar', 'mozzarella', 'parmesan', 'brie'],
    butter: ['dairy', 'spread', 'margarine'],
    yogurt: ['yoghurt', 'dairy', 'probiotic', 'cultured'],
    eggs: ['egg', 'poultry', 'fresh', 'dairy'],
    cream: ['heavy cream', 'whipping cream', 'dairy', 'sour cream'],
    // ── Meat & poultry → chapter 2/3/16 ──────────────────────────────────────
    beef: ['steak', 'ground beef', 'meat', 'bovine', 'brisket', 'sirloin'],
    chicken: ['poultry', 'meat', 'broiler', 'fowl', 'breast', 'thigh'],
    pork: ['swine', 'meat', 'ham', 'lard', 'sausage'],
    turkey: ['poultry', 'meat', 'fowl'],
    lamb: ['mutton', 'sheep', 'meat'],
    bacon: ['pork', 'cured', 'smoked', 'meat', 'breakfast'],
    salmon: ['fish', 'seafood', 'fresh', 'fillet', 'atlantic'],
    tuna: ['fish', 'seafood', 'fresh', 'fillet', 'albacore'],
    shrimp: ['prawn', 'seafood', 'shellfish', 'fresh', 'frozen'],
    lobster: ['seafood', 'shellfish', 'crustacean'],
    crab: ['seafood', 'shellfish', 'crustacean', 'crabmeat'],
    // ── Condiments & sauces → chapter 21 ─────────────────────────────────────
    ketchup: ['catsup', 'tomato sauce', 'condiment', 'sauce'],
    mustard: ['condiment', 'sauce', 'dijon'],
    mayonnaise: ['mayo', 'condiment', 'sauce', 'dressing'],
    vinegar: ['condiment', 'acid', 'apple cider', 'balsamic'],
    salsa: ['tomato salsa', 'condiment', 'sauce', 'dip'],
    relish: ['pickle relish', 'condiment', 'sauce'],
    // ── Beverages → chapter 20/22 ─────────────────────────────────────────────
    juice: ['fruit juice', 'orange juice', 'apple juice', 'beverage', 'drink'],
    soda: ['cola', 'carbonated', 'soft drink', 'beverage', 'pop'],
    lemonade: ['lemon drink', 'beverage', 'soft drink'],
    smoothie: ['blended', 'fruit drink', 'beverage', 'shake'],
    // ── Snacks → chapter 19/21 ────────────────────────────────────────────────
    chips: ['crisps', 'potato chips', 'corn chips', 'snack', 'tortilla chips'],
    popcorn: ['popped corn', 'snack'],
    crackers: ['cracker', 'snack', 'biscuit', 'wafer'],
    pretzels: ['pretzel', 'snack', 'baked'],
    granola: ['granola bar', 'cereal', 'oats', 'snack'],
    // ── Tablet & smart devices → chapter 84/85 ────────────────────────────────
    tablet: ['ipad', 'android tablet', 'slate', 'digital tablet'],
    projector: ['video projector', 'lcd projector', 'dlp', 'beamer', 'display'],
    // ── Kitchen appliances → chapter 84 ──────────────────────────────────────
    'food blender': ['smoothie maker', 'blender', 'juicer', 'mixer appliance'],
    toaster: ['bread toaster', 'toasting', 'kitchen appliance'],
    iron: ['clothes iron', 'steam iron', 'garment iron', 'pressing', 'ironing'],
    fan: ['electric fan', 'ceiling fan', 'desk fan', 'cooling', 'ventilation'],
    // ── Apparel additions → chapter 61/62 ────────────────────────────────────
    shorts: ['short pants', 'bermuda', 'cut-offs', 'bottoms', 'apparel'],
    pajamas: ['pyjamas', 'sleepwear', 'nightwear', 'lounge', 'apparel'],
    necktie: ['tie', 'cravat', 'neckwear', 'formal', 'apparel'],
    blazer: ['suit jacket', 'sport coat', 'formal', 'apparel'],
    polo: ['polo shirt', 'golf shirt', 'top', 'apparel'],
    cardigan: ['knitwear', 'sweater', 'jumper', 'top', 'apparel'],
    vest: ['tank top', 'undershirt', 'sleeveless', 'apparel'],
    bathrobe: ['robe', 'dressing gown', 'towel robe', 'loungewear', 'apparel'],
    apron: ['kitchen apron', 'bib', 'cooking apron', 'apparel'],
    romper: ['jumpsuit', 'one-piece', 'playsuit', 'apparel'],
    // ── Furniture additions → chapter 94 ─────────────────────────────────────
    sofa: ['couch', 'settee', 'loveseat', 'sectional', 'furniture'],
    armchair: ['recliner', 'lounge chair', 'easy chair', 'furniture'],
    bookshelf: ['bookcase', 'shelving', 'shelves', 'storage', 'furniture'],
    wardrobe: ['closet', 'armoire', 'clothes cabinet', 'furniture'],
    dresser: ['chest of drawers', 'bureau', 'commode', 'furniture'],
    nightstand: ['bedside table', 'night table', 'bedroom', 'furniture'],
    clock: ['wall clock', 'alarm clock', 'timepiece', 'horology'],
    // ── Hand tools → chapter 82 ───────────────────────────────────────────────
    hammer: ['claw hammer', 'mallet', 'hand tool'],
    screwdriver: ['flathead', 'phillips', 'hand tool', 'driver'],
    wrench: ['spanner', 'adjustable wrench', 'hand tool'],
    pliers: ['needle-nose', 'locking pliers', 'hand tool', 'gripping'],
    // ── Power tools → chapter 84/85 ──────────────────────────────────────────
    drill: ['electric drill', 'power drill', 'cordless drill', 'drilling'],
    // ── Baby products → chapter 94/62 ─────────────────────────────────────────
    crib: ['baby crib', 'baby bed', 'cot', 'bassinet', 'infant bed'],
    // ── Pet supplies → chapter 42/94 ──────────────────────────────────────────
    aquarium: ['fish tank', 'terrarium', 'vivarium', 'glass tank'],
    // ── Garden → chapter 73/39 ─────────────────────────────────────────────────
    planter: ['flower pot', 'plant pot', 'garden pot', 'container'],
    // ── Sports additions → chapter 95 ─────────────────────────────────────────
    hammock: ['hanging bed', 'camp hammock', 'porch hammock', 'outdoor'],
    // ── First aid / medical → chapter 30/90 ──────────────────────────────────
    bandage: ['wound dressing', 'first aid', 'adhesive bandage', 'plaster'],
    thermometer: ['temperature gauge', 'fever thermometer', 'clinical thermometer'],
    // ── Holiday & seasonal → chapter 95 ──────────────────────────────────────
    ornament: ['christmas ornament', 'tree ornament', 'xmas ornament', 'holiday decoration'],
    // ── Flooring → chapter 44/39/57 ──────────────────────────────────────────
    laminate: ['laminate floor', 'flooring', 'vinyl plank'],
    // ── Automotive → chapter 87 ───────────────────────────────────────────────
    dashcam: ['car camera', 'vehicle camera', 'driving recorder'],
    // ── Smart home → chapter 85 ───────────────────────────────────────────────
    doorbell: ['video doorbell', 'smart doorbell', 'ring doorbell', 'home security'],
    thermostat: ['smart thermostat', 'heating control', 'hvac control'],
    // ── Educational toys → chapter 95 ─────────────────────────────────────────
    doll: ['toy doll', 'barbie', 'fashion doll', 'stuffed doll', 'baby doll'],
    lego: ['building blocks', 'construction toy', 'brick', 'toy'],
    // ── Stationery → chapter 48 ───────────────────────────────────────────────
    envelope: ['mailer', 'mailing envelope', 'postal envelope'],
    binder: ['ring binder', 'folder', 'file binder'],
    // ── Cleaning supplies → chapter 34/39 ─────────────────────────────────────
    mop: ['floor mop', 'cleaning mop', 'spin mop'],
    broom: ['sweeping broom', 'floor broom', 'cleaning'],
    sponge: ['cleaning sponge', 'dish sponge', 'kitchen sponge', 'scrubber'],
    // ── Photography → chapter 90 ──────────────────────────────────────────────
    'memory card': ['sd card', 'flash storage', 'microsd', 'storage card'],
    // ── Musical instruments → chapter 92 additions ─────────────────────────────
    flute: ['wind instrument', 'woodwind', 'musical'],
    trumpet: ['brass', 'wind instrument', 'musical', 'horn'],
    saxophone: ['sax', 'woodwind', 'wind instrument', 'musical'],
    harp: ['string instrument', 'musical', 'plucked'],
    cello: ['string instrument', 'musical', 'bowed'],
    ukulele: ['string instrument', 'musical', 'guitar'],
    // ── Yarn & textile → chapter 52/55 ────────────────────────────────────────
    yarn: ['thread', 'wool', 'knitting yarn', 'crochet', 'fiber'],
    fabric: ['cloth', 'textile', 'material', 'woven'],
    ribbon: ['decorative ribbon', 'satin ribbon', 'grosgrain', 'trim'],
    // ── Bags & cases → chapter 42 ─────────────────────────────────────────────
    'gym bag': ['duffel bag', 'sports bag', 'workout bag', 'athletic bag'],
    'messenger bag': ['shoulder bag', 'satchel', 'crossbody bag'],
    'fanny pack': ['waist bag', 'belt bag', 'bum bag'],
    // ── Jewelry additions → chapter 71 ────────────────────────────────────────
    bracelet: ['bangle', 'wristband', 'charm bracelet', 'jewelry', 'jewellery'],
    'pendant necklace': ['chain necklace', 'choker necklace', 'locket', 'jewelry'],
    earring: ['earrings', 'stud', 'hoop', 'drop earring', 'jewelry'],
    // ── Skincare additions → chapter 33 ───────────────────────────────────────
    'face cream': ['body lotion', 'skin cream', 'hydrating cream', 'daily moisturizer'],
    'face serum': ['skin serum', 'vitamin c serum', 'hyaluronic acid', 'retinol serum'],
    toner: ['face toner', 'astringent', 'skincare'],
    exfoliator: ['scrub', 'exfoliant', 'face scrub', 'body scrub', 'skincare'],
    // ── Hair care additions → chapter 33 ──────────────────────────────────────
    'hair mask': ['hair treatment', 'deep conditioner', 'leave-in conditioner'],
    // ── Office electronics → chapter 84/85 ───────────────────────────────────
    'lcd monitor': ['led monitor', 'gaming monitor', 'ultrawide monitor', '4k monitor'],
    'inkjet printer': ['laser printer', 'document printer', 'photo printer', 'label printer'],
    'document scanner': ['flatbed scanner', 'photo scanner', 'portable scanner'],
    webcam: ['web camera', 'streaming camera', 'conference camera'],
    // ── Storage & organization → chapter 39/73 ────────────────────────────────
    bin: ['storage bin', 'plastic bin', 'container', 'organizer'],
    basket: ['storage basket', 'wicker basket', 'laundry basket'],
    // ── Bed & bath → chapter 63 ───────────────────────────────────────────────
    'sleeping pillow': ['bed pillow', 'memory foam pillow', 'down pillow', 'body pillow'],
    'bed sheet': ['sheets', 'fitted sheet', 'flat sheet', 'bedding'],
    duvet: ['comforter', 'quilt', 'duvet cover', 'bedding'],
    'bath mat': ['bathroom mat', 'shower mat', 'anti-slip mat'],
    // ── Aromatherapy → chapter 34 ─────────────────────────────────────────────
    diffuser: ['aroma diffuser', 'essential oil diffuser', 'ultrasonic diffuser'],
    // ── Security & locks → chapter 83 ─────────────────────────────────────────
    lock: ['door lock', 'security lock', 'combination lock', 'deadbolt'],
    safe: ['gun safe', 'fireproof safe', 'security safe', 'vault'],
    // ── Cables & connectors → chapter 85 ──────────────────────────────────────
    hdmi: ['hdmi cable', 'video cable', 'display cable'],
    // ── Fitness equipment → chapter 95 ────────────────────────────────────────
    treadmill: ['running machine', 'exercise treadmill', 'fitness equipment'],
    // ── Food preparation → chapter 84 ─────────────────────────────────────────
    grater: ['cheese grater', 'food grater', 'kitchen grater', 'zester'],
    colander: ['strainer', 'pasta strainer', 'kitchen strainer'],
    whisk: ['egg whisk', 'wire whisk', 'kitchen whisk', 'beater'],
    // ── Bakeware → chapter 73 ─────────────────────────────────────────────────
    'baking pan': ['cake pan', 'baking tray', 'sheet pan', 'bakeware'],
    'rolling pin': ['dough roller', 'pastry roller', 'baking tool'],
    // ── Wall decor → chapter 49/44 ────────────────────────────────────────────
    tapestry: ['wall tapestry', 'woven wall art', 'wall hanging'],
    // ── Luggage additions → chapter 42 ────────────────────────────────────────
    'rolling suitcase': ['hard shell suitcase', 'carry-on suitcase', 'checked luggage', 'trolley bag'],
    // ── Water sports → chapter 95 ─────────────────────────────────────────────
    snorkel: ['snorkeling', 'dive mask', 'underwater', 'snorkel set'],
    // ── Climbing / outdoor → chapter 63/73 ────────────────────────────────────
    carabiner: ['climbing carabiner', 'snap hook', 'clip'],
    // ── Tableware → chapter 69/70 ─────────────────────────────────────────────
    'coffee mug': ['tea mug', 'ceramic mug', 'travel mug', 'soup mug'],
    'serving bowl': ['soup bowl', 'salad bowl', 'cereal bowl', 'pasta bowl'],
    'dinner plate': ['serving plate', 'ceramic plate', 'salad plate', 'dessert plate'],
    // ── Electronics accessories → chapter 85 ──────────────────────────────────
    hub: ['usb hub', 'data hub', 'port hub', 'switching hub'],
    adapter: ['power adapter', 'usb adapter', 'plug adapter', 'travel adapter'],
    // ── Office supplies → chapter 48/96 ───────────────────────────────────────
    stapler: ['stapling', 'binding', 'office tool'],
    calculator: ['computing', 'math tool', 'arithmetic', 'office'],
    shredder: ['paper shredder', 'document shredder', 'office machine'],
    // ── Watches & clocks additions → chapter 91 ────────────────────────────────
    'smart wristwatch': ['apple watch', 'fitness watch', 'wearable watch'],
    // ── Sewing & craft → chapter 84/96 ────────────────────────────────────────
    'sewing machine': ['embroidery machine', 'overlock', 'serger', 'stitching machine'],
    // ── Outdoor furniture → chapter 94 ────────────────────────────────────────
    'patio chair': ['garden chair', 'outdoor chair', 'lawn chair', 'deck chair'],
    'patio table': ['garden table', 'outdoor table', 'bistro table'],
    // ── Signage → chapter 49/39 ───────────────────────────────────────────────
    'neon sign': ['led sign', 'illuminated sign', 'custom sign', 'wall sign'],
    // ── Food packaging → chapter 39/48 ────────────────────────────────────────
    'food container': ['meal prep container', 'plastic container', 'lunch box'],
    'zip bag': ['ziploc bag', 'resealable bag', 'storage bag', 'freezer bag'],
    // ── Kitchen utensils → chapter 82 ─────────────────────────────────────────
    spatula: ['cooking spatula', 'rubber spatula', 'kitchen tool'],
    ladle: ['soup ladle', 'serving ladle', 'kitchen utensil'],
    tongs: ['kitchen tongs', 'serving tongs', 'barbecue tongs'],
    // ── Lumber & wood → chapter 44 ────────────────────────────────────────────
    plywood: ['plywood sheet', 'wood panel', 'engineered wood', 'timber'],
    lumber: ['wood board', 'timber', 'pine board', 'hardwood board'],
    'wooden pallet': ['wood pallet', 'shipping pallet', 'timber pallet'],
    // ── Paper & paperboard → chapter 48 ───────────────────────────────────────
    cardboard: ['corrugated cardboard', 'paperboard', 'cardboard box', 'carton'],
    'wrapping paper': ['gift wrap', 'kraft paper', 'tissue paper wrap'],
    'paper bag': ['kraft paper bag', 'shopping bag paper', 'grocery bag paper'],
    // ── Plastic film & sheeting → chapter 39 ──────────────────────────────────
    'plastic wrap': ['cling wrap', 'cling film', 'food wrap', 'plastic film'],
    'plastic sheet': ['polyethylene sheet', 'polypropylene sheet', 'plastic film'],
    // ── Glass & glassware → chapter 70 ────────────────────────────────────────
    'wine glass': ['crystal glass', 'stemware', 'goblet', 'champagne flute'],
    'shot glass': ['shooter glass', 'spirit glass', 'small glass'],
    'beer glass': ['pint glass', 'beer mug', 'drinking glass'],
    // ── Rubber products → chapter 40 ──────────────────────────────────────────
    'rubber band': ['elastic band', 'office rubber band', 'rubber ring'],
    'rubber glove': ['latex glove', 'cleaning glove', 'protective glove'],
    'rubber mat': ['anti-fatigue mat', 'floor rubber mat', 'non-slip mat'],
    // ── Leather goods → chapter 42 ────────────────────────────────────────────
    'leather wallet': ['bifold wallet', 'leather card holder', 'slim wallet'],
    'leather belt': ['dress belt', 'casual belt', 'leather strap'],
    'leather jacket': ['biker jacket', 'moto jacket', 'leather coat'],
    'leather bag': ['leather tote', 'leather briefcase', 'leather purse'],
    // ── Ceramics & pottery → chapter 69 ───────────────────────────────────────
    teapot: ['ceramic teapot', 'kettle teapot', 'pottery teapot', 'tea set'],
    'ceramic tile': ['floor tile', 'wall tile', 'porcelain tile', 'mosaic tile'],
    // ── Iron & steel products → chapter 73 ────────────────────────────────────
    'steel pipe': ['iron pipe', 'metal tube', 'steel tube', 'plumbing pipe'],
    'steel bar': ['iron bar', 'metal rod', 'rebar', 'reinforcing bar'],
    'metal bracket': ['mounting bracket', 'shelf bracket', 'wall bracket', 'angle bracket'],
    'wire mesh': ['wire fence', 'metal mesh', 'steel mesh', 'chicken wire'],
    // ── Aluminum products → chapter 76 ────────────────────────────────────────
    'aluminum foil tray': ['foil container', 'aluminum baking tray', 'disposable tray'],
    'aluminum profile': ['aluminum extrusion', 'aluminum framing', 'structural aluminum'],
    // ── Electrical → chapter 85 ───────────────────────────────────────────────
    'circuit breaker': ['electrical breaker', 'fuse box', 'panel breaker'],
    'electric motor': ['dc motor', 'ac motor', 'servo motor', 'stepper motor'],
    'power transformer': ['voltage transformer', 'step-down transformer', 'isolation transformer'],
    capacitor: ['electrolytic capacitor', 'electronic component', 'pcb component'],
    resistor: ['electronic resistor', 'circuit component', 'pcb resistor'],
    'led light': ['led lamp', 'led bulb', 'led lighting', 'led panel'],
    'solar panel': ['photovoltaic panel', 'pv panel', 'solar module', 'solar cell'],
    // ── Measuring instruments → chapter 90 ────────────────────────────────────
    microscope: ['optical microscope', 'laboratory microscope', 'digital microscope'],
    telescope: ['astronomical telescope', 'refracting telescope', 'binoculars'],
    'multimeter': ['volt meter', 'ammeter', 'digital multimeter', 'electrical tester'],
    'pressure gauge': ['air pressure gauge', 'tire gauge', 'manometer'],
    // ── Medical devices → chapter 90 ──────────────────────────────────────────
    'wheelchair': ['manual wheelchair', 'electric wheelchair', 'transport wheelchair'],
    crutches: ['forearm crutch', 'underarm crutch', 'walking crutch'],
    'hearing aid': ['hearing device', 'ear hearing aid', 'digital hearing aid'],
    'nebulizer': ['inhaler machine', 'asthma nebulizer', 'respiratory nebulizer'],
    // ── Optical → chapter 90 ──────────────────────────────────────────────────
    'reading glasses': ['eyeglasses', 'spectacles', 'prescription glasses'],
    'magnifying glass': ['loupe', 'magnifier', 'hand lens'],
    // ── Clocks & watches more → chapter 91 ────────────────────────────────────
    'pocket watch': ['chain watch', 'antique watch', 'mechanical pocket watch'],
    'watch strap': ['watch band', 'watch bracelet', 'replacement strap'],
    // ── Musical accessories → chapter 92 ──────────────────────────────────────
    'guitar string': ['acoustic strings', 'electric strings', 'bass strings', 'string set'],
    'guitar pick': ['plectrum', 'guitar plectrum', 'pick set'],
    'drum stick': ['drumsticks', 'drum brush', 'percussion stick'],
    'music stand': ['sheet music stand', 'orchestral stand', 'adjustable stand'],
    // ── Sporting goods more → chapter 95 ──────────────────────────────────────
    'golf club': ['golf iron', 'golf driver', 'golf wedge', 'putter'],
    'golf ball': ['golf balls', 'golf equipment'],
    'ski': ['skis', 'ski equipment', 'alpine ski', 'downhill ski'],
    'snowboard': ['snowboards', 'freestyle snowboard', 'alpine snowboard'],
    'surfboard': ['surf board', 'longboard surfboard', 'shortboard', 'bodyboard'],
    'boxing glove': ['boxing gloves', 'punching glove', 'sparring glove'],
    'punching bag': ['heavy bag', 'boxing bag', 'training bag'],
    'archery bow': ['compound bow', 'recurve bow', 'crossbow', 'archery'],
    // ── Arts & crafts → chapter 95/32 ────────────────────────────────────────
    'paint brush': ['artist brush', 'acrylic brush', 'watercolor brush', 'paintbrush'],
    'acrylic paint': ['artist paint', 'craft paint', 'paint set', 'watercolor paint'],
    'stretched canvas': ['artist canvas', 'canvas board', 'canvas roll', 'painting canvas'],
    'colored pencil': ['colour pencil', 'drawing pencil', 'art pencil', 'pencil set'],
    // ── School supplies → chapter 48/84 ───────────────────────────────────────
    ruler: ['measuring ruler', 'plastic ruler', 'metal ruler', 'straightedge'],
    compass: ['drawing compass', 'geometry compass', 'drafting compass'],
    protractor: ['angle protractor', 'geometry protractor', 'math tool'],
    'pencil case': ['pen case', 'stationery case', 'pencil pouch', 'pencil bag'],
    // ── Baby & toddler → chapter 95/62 ────────────────────────────────────────
    'baby bottle': ['infant bottle', 'feeding bottle', 'nursing bottle', 'sippy cup'],
    'pacifier': ['dummy', 'soother', 'infant pacifier', 'baby soother'],
    'baby blanket': ['infant blanket', 'receiving blanket', 'swaddle blanket'],
    'baby shower': ['baby toy', 'rattle', 'teething toy', 'infant toy'],
    // ── Pet accessories → chapter 42/95 ───────────────────────────────────────
    'dog toy': ['pet toy', 'chew toy', 'squeaky toy', 'rope toy'],
    'cat toy': ['pet toy', 'cat wand', 'feather toy', 'laser pointer'],
    'pet carrier': ['pet travel bag', 'dog carrier', 'cat carrier', 'animal carrier'],
    'pet bowl': ['dog bowl', 'cat bowl', 'pet feeding bowl', 'water bowl'],
    'bird cage': ['birdcage', 'parrot cage', 'avian cage', 'pet cage'],
    // ── Automotive parts → chapter 87 ─────────────────────────────────────────
    'car battery': ['auto battery', 'vehicle battery', 'automotive battery'],
    'car filter': ['oil filter', 'air filter', 'fuel filter', 'cabin filter'],
    'windshield wiper': ['wiper blade', 'rain wiper', 'windscreen wiper'],
    'car speaker': ['auto speaker', 'vehicle speaker', 'car audio'],
    'car jack': ['floor jack', 'hydraulic jack', 'scissor jack', 'lifting jack'],
    // ── HVAC → chapter 84 ─────────────────────────────────────────────────────
    'air conditioner': ['ac unit', 'room air conditioner', 'split ac', 'window ac'],
    'dehumidifier': ['room dehumidifier', 'portable dehumidifier', 'moisture remover'],
    'humidifier': ['room humidifier', 'cool mist humidifier', 'ultrasonic humidifier'],
    // ── Plumbing → chapter 73/39 ──────────────────────────────────────────────
    faucet: ['tap', 'water faucet', 'kitchen faucet', 'bathroom faucet', 'mixer tap'],
    'shower head': ['shower showerhead', 'rain shower head', 'handheld shower'],
    'toilet seat': ['toilet lid', 'bathroom toilet seat', 'bidet seat'],
    // ── Lighting additions → chapter 94 ───────────────────────────────────────
    'floor lamp': ['standing lamp', 'torchiere lamp', 'arc floor lamp'],
    'table lamp': ['desk lamp', 'bedside lamp', 'reading lamp', 'night lamp'],
    chandelier: ['hanging chandelier', 'ceiling chandelier', 'crystal chandelier'],
    // ── Home security → chapter 85 ────────────────────────────────────────────
    'smoke detector': ['smoke alarm', 'fire detector', 'carbon monoxide detector'],
    'motion sensor': ['pir sensor', 'motion detector', 'occupancy sensor'],
    // ── Garage & workshop → chapter 84 ────────────────────────────────────────
    'garage door opener': ['automatic door opener', 'remote door opener'],
    'workbench': ['work bench', 'workshop table', 'tool bench'],
    'storage cabinet': ['tool cabinet', 'garage cabinet', 'metal cabinet'],
    // ── Craft & hobby → chapter 95/39 ─────────────────────────────────────────
    '3d printer filament': ['pla filament', 'abs filament', 'petg filament', 'printing filament'],
    'resin': ['epoxy resin', 'uv resin', 'casting resin', 'craft resin'],
    'hot glue gun': ['glue gun', 'glue sticks', 'craft glue gun'],
    // ── Food ingredients → chapter 11/10 ─────────────────────────────────────
    flour: ['all-purpose flour', 'wheat flour', 'bread flour', 'cake flour'],
    sugar: ['white sugar', 'brown sugar', 'cane sugar', 'powdered sugar'],
    'baking soda': ['sodium bicarbonate', 'baking powder', 'leavening'],
    yeast: ['active dry yeast', 'instant yeast', 'baking yeast', 'leavening'],
    // ── Canned & preserved food → chapter 20/16 ──────────────────────────────
    'canned tuna': ['tuna can', 'canned fish', 'preserved fish'],
    'canned beans': ['canned legumes', 'preserved beans', 'kidney beans can'],
    'canned vegetables': ['canned corn', 'canned tomatoes', 'preserved vegetables'],
    jam: ['fruit jam', 'fruit preserve', 'jelly', 'marmalade', 'fruit spread'],
    // ── Frozen food → chapter 16/20 ───────────────────────────────────────────
    'frozen pizza': ['pizza', 'frozen meal', 'ready meal'],
    'frozen vegetables': ['frozen peas', 'frozen corn', 'mixed vegetables frozen'],
    // ── Nuts & seeds → chapter 8 ──────────────────────────────────────────────
    'roasted almonds': ['almond', 'sliced almond', 'blanched almond'],
    'roasted cashew': ['cashew nut', 'raw cashew'],
    'walnut halves': ['walnut pieces', 'chopped walnut', 'black walnut'],
    'roasted peanuts': ['salted peanuts', 'boiled peanuts', 'dry roasted peanuts'],
    // ── Coffee additions → chapter 9 ──────────────────────────────────────────
    'coffee pod': ['k-cup', 'espresso pod', 'nespresso pod', 'coffee capsule'],
    'ground coffee': ['coffee grounds', 'espresso grounds', 'filter coffee'],
    // ── Protein powder → chapter 21 ───────────────────────────────────────────
    'protein bar': ['energy bar', 'nutrition bar', 'snack bar', 'meal bar'],
    // ── Skincare more → chapter 33 ────────────────────────────────────────────
    'face mask': ['sheet mask', 'clay mask', 'facial mask', 'peel-off mask'],
    'eye cream': ['under eye cream', 'eye gel', 'dark circle cream'],
    'bb cream': ['cc cream', 'tinted moisturizer', 'foundation cream'],
    // ── Makeup more → chapter 33 ──────────────────────────────────────────────
    blush: ['cheek blush', 'powder blush', 'blush palette', 'rouge'],
    bronzer: ['face bronzer', 'contouring powder', 'highlight powder'],
    concealer: ['face concealer', 'color corrector', 'spot concealer'],
    highlighter: ['face highlighter', 'illuminating powder', 'strobe powder'],
    'makeup brush': ['foundation brush', 'blush brush', 'eyeshadow brush', 'beauty brush'],
    // ── Hair styling → chapter 85/33 ──────────────────────────────────────────
    'hair straightener': ['flat iron', 'hair flat iron', 'ceramic straightener'],
    'hair curler': ['curling iron', 'curling wand', 'hair waver'],
    'hair clipper': ['hair trimmer', 'barber clipper', 'beard trimmer clipper'],
    // ── Oral care → chapter 33/90 ─────────────────────────────────────────────
    toothpaste: ['dental paste', 'whitening toothpaste', 'fluoride toothpaste'],
    mouthwash: ['mouth rinse', 'oral rinse', 'antiseptic mouthwash'],
    'dental floss': ['floss', 'oral floss', 'tooth floss', 'floss picks'],
    // ── Vitamins & supplements more → chapter 21/30 ───────────────────────────
    'fish oil': ['omega-3', 'omega 3 supplement', 'cod liver oil', 'dha supplement'],
    'vitamin d': ['vitamin d3', 'cholecalciferol', 'sunshine vitamin', 'bone supplement'],
    collagen: ['collagen supplement', 'collagen peptide', 'marine collagen'],
    'probiotic': ['probiotic supplement', 'gut health', 'lactobacillus'],
    // ── Cleaning products → chapter 34 ────────────────────────────────────────
    bleach: ['chlorine bleach', 'laundry bleach', 'disinfectant bleach', 'sodium hypochlorite'],
    'laundry detergent': ['washing powder', 'laundry powder', 'clothes detergent'],
    'fabric softener': ['clothes softener', 'dryer sheet', 'fabric conditioner'],
    'dishwasher tablet': ['dishwasher pod', 'dishwasher detergent', 'dish tablet'],
    // ── Bags additions → chapter 42 ───────────────────────────────────────────
    'diaper bag': ['nappy bag', 'baby changing bag', 'mommy bag'],
    'laptop bag': ['computer bag', 'notebook bag', 'work bag'],
    'camera bag': ['photography bag', 'camera backpack', 'lens bag'],
    // ── Phone accessories → chapter 85/39 ─────────────────────────────────────
    'wireless charger': ['qi charger', 'inductive charger', 'charging pad'],
    'phone grip': ['pop socket', 'phone holder grip', 'ring stand', 'phone ring'],
    // ── Computer peripherals → chapter 84 ─────────────────────────────────────
    'mouse pad': ['gaming mouse pad', 'desk mat', 'mouse mat'],
    'keyboard cover': ['keyboard skin', 'silicone keyboard cover'],
    'laptop stand': ['notebook stand', 'computer stand', 'desk riser'],
    // ── Audio → chapter 85 ────────────────────────────────────────────────────
    'record player': ['turntable', 'vinyl player', 'phonograph'],
    'bluetooth soundbar': ['tv sound bar', 'home theater bar', 'subwoofer bar'],
    // ── Wearables → chapter 85/90 ─────────────────────────────────────────────
    'activity tracker': ['step counter', 'pedometer', 'health band', 'sport band'],
    'vr headset': ['virtual reality headset', 'vr goggles', 'meta quest', 'oculus'],
    // ── Office furniture → chapter 94 ─────────────────────────────────────────
    'standing desk': ['height adjustable desk', 'sit stand desk', 'electric desk'],
    'monitor arm': ['monitor mount', 'desk arm', 'dual monitor arm'],
    // ── Printing & media → chapter 84/37 ──────────────────────────────────────
    'printer ink': ['ink cartridge', 'toner cartridge', 'inkjet cartridge'],
    // ── Outdoor recreation → chapter 95 ───────────────────────────────────────
    'kayak': ['canoe', 'inflatable kayak', 'sea kayak', 'paddle'],
    'bicycle pump': ['bike pump', 'floor pump', 'portable pump', 'tire pump'],
    // ── Watches accessories → chapter 91 ──────────────────────────────────────
    'watch box': ['watch case', 'watch storage box', 'jewelry box'],
    // ── Fashion accessories → chapter 71 ──────────────────────────────────────
    'hair clip': ['barrette', 'hair clasp', 'bobby pin', 'hair pin'],
    'hair band': ['hair tie', 'scrunchie', 'elastic hair band', 'ponytail holder'],
    'cufflinks': ['cuff links', 'shirt cufflinks', 'formal cufflinks', 'men accessory'],
    brooch: ['pin brooch', 'lapel pin', 'fashion brooch', 'jewelry brooch'],
    // ── Seasonal / garden → chapter 95/44 ────────────────────────────────────
    'bird feeder': ['garden bird feeder', 'hanging feeder', 'wildlife feeder'],
    'garden hose nozzle': ['spray nozzle', 'hose spray', 'garden spray nozzle'],
    'rake': ['garden rake', 'leaf rake', 'lawn rake', 'soil rake'],
    'shovel': ['garden shovel', 'spade', 'digging shovel', 'hand shovel'],
    // ── Pest control → chapter 38 ─────────────────────────────────────────────
    insecticide: ['bug spray', 'insect killer', 'pest spray', 'mosquito spray'],
    'rat trap': ['mouse trap', 'rodent trap', 'pest trap'],
    // ── Storage solutions → chapter 39/73 ─────────────────────────────────────
    'storage rack': ['shelving rack', 'wire rack', 'garage rack', 'metal shelving'],
    'toolbox': ['tool chest', 'tool storage box', 'mechanics toolbox'],
    'jewelry box': ['jewelry organizer', 'ring box', 'necklace box', 'vanity box'],
    // ── Labels & tags → chapter 48 ────────────────────────────────────────────
    'vinyl sticker': ['adhesive sticker', 'custom sticker', 'decal sticker', 'wall decal'],
    'price tag': ['hang tag', 'clothing tag', 'retail tag', 'label tag'],
    // ── Protective gear → chapter 62/39 ───────────────────────────────────────
    'safety vest': ['reflective vest', 'hi-vis vest', 'high visibility vest'],
    'hard hat': ['safety helmet', 'construction helmet', 'work helmet'],
    'safety goggles': ['protective goggles', 'work goggles', 'eye protection'],
    // ── Chemicals & adhesives → chapter 32/35 ─────────────────────────────────
    'epoxy adhesive': ['two part epoxy', 'structural adhesive', 'epoxy glue', 'adhesive'],
    'super glue': ['cyanoacrylate', 'instant adhesive', 'krazy glue', 'contact glue'],
    'spray paint': ['aerosol paint', 'spray can paint', 'rattle can', 'enamel spray'],
    'wall paint': ['interior paint', 'exterior paint', 'latex paint', 'emulsion paint'],
    // ── Fasteners → chapter 73/83 ─────────────────────────────────────────────
    screws: ['screw', 'wood screw', 'machine screw', 'self-tapping screw'],
    bolts: ['bolt', 'hex bolt', 'carriage bolt', 'anchor bolt'],
    'hex nut': ['lock nut', 'wing nut', 'coupling nut', 'fastener nut'],
    'flat washer': ['spring washer', 'lock washer', 'fastener washer'],
    nails: ['nail', 'framing nail', 'finish nail', 'brad nail', 'roofing nail'],
    rivets: ['rivet', 'blind rivet', 'pop rivet', 'aluminum rivet'],
    'zip ties': ['cable tie', 'plastic tie', 'wire tie', 'nylon tie'],
    // ── Adhesive tape → chapter 39 ────────────────────────────────────────────
    'duct tape': ['gaffer tape', 'silver tape', 'sealing tape', 'cloth tape'],
    'masking tape': ['painters tape', 'blue tape', 'washi tape', 'paper tape'],
    'double sided tape': ['mounting tape', 'foam tape', 'permanent tape'],
    // ── Wire & cable → chapter 85 ─────────────────────────────────────────────
    'ethernet cable': ['network cable', 'cat6 cable', 'cat5 cable', 'lan cable'],
    'coaxial cable': ['coax cable', 'rg6 cable', 'antenna cable', 'tv cable'],
    'speaker wire': ['speaker cable', 'audio wire', 'amplifier wire'],
    // ── Batteries → chapter 85 ────────────────────────────────────────────────
    'aa battery': ['double-a battery', 'alkaline battery', 'lr6 battery'],
    'aaa battery': ['triple-a battery', 'alkaline battery', 'lr03'],
    'lithium battery': ['li-ion battery', 'rechargeable battery', 'lithium cell'],
    // ── Semiconductor & electronics components → chapter 85 ───────────────────
    'arduino': ['microcontroller', 'development board', 'raspberry pi', 'esp32'],
    'led strip': ['rgb strip', 'flexible led', 'light strip', 'tape light'],
    'heat sink': ['cpu cooler', 'heatsink', 'thermal radiator', 'aluminum cooler'],
    // ── Networking hardware → chapter 85 ──────────────────────────────────────
    'network switch': ['ethernet switch', 'managed switch', 'unmanaged switch'],
    'wireless access point': ['wifi access point', 'ap router', 'access point'],
    modem: ['cable modem', 'dsl modem', 'fiber modem', 'network modem'],
    // ── Phone parts → chapter 85 ──────────────────────────────────────────────
    'phone screen': ['lcd screen', 'oled screen', 'phone display', 'screen replacement'],
    'phone battery': ['mobile battery', 'smartphone battery', 'battery replacement'],
    // ── Camera equipment → chapter 90 ─────────────────────────────────────────
    'camera tripod': ['photography tripod', 'video tripod', 'flexible tripod', 'gorilla pod'],
    'camera flash': ['speedlight', 'external flash', 'hot shoe flash', 'strobe flash'],
    'nd filter': ['neutral density filter', 'camera filter', 'lens filter', 'uv filter'],
    'gimbal': ['camera gimbal', 'phone gimbal', 'video stabilizer', 'stabilizer'],
    // ── 3D printing → chapter 84/39 ───────────────────────────────────────────
    '3d printer': ['fdm printer', 'resin printer', 'sla printer', 'fff printer'],
    // ── Drones → chapter 88 ───────────────────────────────────────────────────
    'drone propeller': ['quadcopter propeller', 'uav propeller', 'replacement propeller'],
    'drone battery': ['lipo battery', 'quadcopter battery', 'uav battery'],
    // ── Lab equipment → chapter 90 ────────────────────────────────────────────
    beaker: ['laboratory beaker', 'glass beaker', 'plastic beaker', 'borosilicate beaker'],
    'test tube': ['laboratory tube', 'glass tube', 'culture tube'],
    'petri dish': ['culture dish', 'laboratory dish', 'agar dish'],
    pipette: ['micropipette', 'dropper', 'transfer pipette', 'pasteur pipette'],
    // ── Sporting goods more → chapter 95 ──────────────────────────────────────
    'baseball bat': ['softball bat', 'aluminum bat', 'wooden bat', 'training bat'],
    'cricket bat': ['cricket equipment', 'willow bat', 'practice bat'],
    'hockey stick': ['ice hockey stick', 'field hockey stick', 'puck'],
    'ping pong': ['table tennis', 'ping pong paddle', 'table tennis paddle', 'racket'],
    'dart board': ['dartboard', 'dart set', 'bullseye board', 'bristle board'],
    'billiard cue': ['pool cue', 'billiard stick', 'snooker cue', 'pool stick'],
    'volleyball net': ['badminton net', 'tennis net', 'sports net'],
    // ── Exercise equipment → chapter 95 ───────────────────────────────────────
    'adjustable dumbbell': ['hex dumbbell', 'neoprene dumbbell', 'rubber dumbbell'],
    'olympic barbell': ['weight bar', 'straight bar', 'curl bar', 'ez bar'],
    'weight plate': ['olympic plate', 'barbell plate', 'iron plate', 'bumper plate'],
    'pull-up bar': ['chin-up bar', 'doorframe bar', 'wall pull-up bar'],
    'ab roller': ['abdominal roller', 'core roller', 'ab wheel'],
    'exercise mat': ['gym mat', 'fitness mat', 'workout mat', 'floor mat exercise'],
    'bench press': ['weight bench', 'gym bench', 'adjustable bench', 'flat bench'],
    // ── Outdoor furniture more → chapter 94 ───────────────────────────────────
    'sun lounger': ['beach lounger', 'chaise lounge', 'reclining chair', 'poolside chair'],
    'garden bench': ['outdoor bench', 'park bench', 'wooden bench outdoor'],
    'picnic table': ['outdoor picnic table', 'folding picnic table', 'garden table'],
    // ── Heating appliances → chapter 85 ───────────────────────────────────────
    'electric heater': ['space heater', 'portable heater', 'room heater', 'convector heater'],
    'heated blanket': ['electric blanket', 'warming blanket', 'electric throw'],
    'heat gun': ['hot air gun', 'heat blower', 'paint stripper gun'],
    // ── Sewing supplies → chapter 56/96 ──────────────────────────────────────
    thread: ['sewing thread', 'polyester thread', 'cotton thread', 'embroidery thread sew'],
    'sewing needle': ['hand needle', 'embroidery needle', 'tapestry needle'],
    'knitting needle': ['crochet hook', 'circular needle', 'dpn needle'],
    'zipper': ['zip fastener', 'metal zipper', 'nylon zipper', 'invisible zipper'],
    // ── Bags accessories → chapter 42 ─────────────────────────────────────────
    'bag charm': ['purse charm', 'key charm', 'handbag charm', 'bag pendant'],
    // ── Travel accessories → chapter 42/39 ────────────────────────────────────
    'travel pillow': ['neck pillow travel', 'airplane pillow', 'memory foam travel pillow'],
    'luggage tag': ['bag tag', 'suitcase tag', 'travel tag', 'name tag luggage'],
    'luggage lock': ['tsa lock', 'combination luggage lock', 'travel lock'],
    'passport holder': ['passport cover', 'passport wallet', 'travel document holder'],
    // ── Furniture hardware → chapter 83 ───────────────────────────────────────
    'door hinge': ['butt hinge', 'cabinet hinge', 'piano hinge', 'concealed hinge'],
    'cabinet knob': ['drawer knob', 'furniture knob', 'cupboard knob'],
    'cabinet handle': ['drawer handle', 'pull handle', 'bar handle', 'furniture handle'],
    // ── Plumbing fittings → chapter 73/39 ────────────────────────────────────
    'pipe fitting': ['elbow fitting', 'tee fitting', 'reducer fitting', 'coupling fitting'],
    valve: ['ball valve', 'gate valve', 'check valve', 'solenoid valve'],
    // ── Solar & energy → chapter 85 ───────────────────────────────────────────
    'solar charger': ['solar power bank', 'solar charging panel', 'portable solar charger'],
    'inverter': ['power inverter', 'solar inverter', 'dc ac inverter', 'ups inverter'],
    // ── Camping & outdoor → chapter 73/39 ────────────────────────────────────
    'camp chair': ['folding chair', 'camping chair', 'collapsible chair', 'portable chair'],
    'camp table': ['folding table', 'camping table', 'portable table'],
    'water filter': ['water purifier', 'camping filter', 'survival filter', 'filter straw'],
    'headlamp': ['head torch', 'head flashlight', 'led headlamp', 'running headlamp'],
    // ── Survival & emergency → chapter 39/70 ──────────────────────────────────
    'first aid kit': ['emergency kit', 'medical kit', 'survival kit', 'trauma kit'],
    'emergency blanket': ['mylar blanket', 'space blanket', 'thermal blanket emergency'],
    // ── Food service → chapter 39/73 ──────────────────────────────────────────
    'disposable cup': ['paper cup', 'plastic cup disposable', 'coffee cup disposable'],
    'disposable plate': ['paper plate', 'plastic plate disposable', 'foam plate'],
    'food tray': ['serving tray', 'cafeteria tray', 'plastic tray'],
    // ── Hospitality → chapter 63 ──────────────────────────────────────────────
    'hotel towel': ['hand towel', 'face towel', 'gym towel', 'microfiber towel'],
    // ── Personal care → chapter 39/96 ────────────────────────────────────────
    'nail file': ['emery board', 'nail buffer', 'nail care file'],
    'tweezers': ['eyebrow tweezers', 'precision tweezers', 'pointed tweezers'],
    'hair roller': ['foam roller hair', 'velcro roller', 'hot roller'],
    'makeup mirror': ['vanity mirror', 'lighted mirror', 'magnifying mirror cosmetic'],
    // ── School & office → chapter 48 ──────────────────────────────────────────
    'sticky note': ['post-it note', 'self-stick note', 'memo pad', 'notepad sticky'],
    'correction fluid': ['white-out', 'correction tape', 'liquid paper', 'tipp-ex'],
    'rubber stamp': ['self-inking stamp', 'date stamp', 'office stamp', 'ink stamp'],
    'fluorescent marker': ['text marker', 'yellow marker', 'pink highlighter', 'chisel tip marker'],
    // ── Packaging materials → chapter 39/48 ───────────────────────────────────
    'stretch wrap': ['pallet wrap', 'stretch film', 'polyethylene wrap'],
    'foam padding': ['foam sheet', 'polyfoam', 'foam roll', 'packing foam'],
    // ── Industrial materials → chapter 39/54 ──────────────────────────────────
    'nylon rope': ['polyester rope', 'braided rope', 'paracord', 'polypropylene rope'],
    'bungee cord': ['elastic cord', 'stretch cord', 'shock cord'],
    // ── Tableware sets → chapter 69/73 ───────────────────────────────────────
    'cutlery set': ['silverware set', 'flatware set', 'dinner set', 'stainless cutlery'],
    'dinner set': ['tableware set', 'dinnerware set', 'plate set', 'dish set'],
    // ── Construction materials → chapter 68 ───────────────────────────────────
    'granite tile': ['natural stone tile', 'marble tile', 'stone slab', 'countertop granite'],
    cement: ['concrete', 'mortar', 'portland cement', 'ready mix cement'],
    'fiberglass': ['fibreglass', 'glass fiber', 'frp panel', 'composite panel'],
    // ── Agricultural → chapter 84 ─────────────────────────────────────────────
    'irrigation system': ['drip irrigation', 'sprinkler system', 'soaker hose'],
    'garden sprayer': ['pump sprayer', 'backpack sprayer', 'pesticide sprayer'],
    // ── Textile more → chapter 54/55 ──────────────────────────────────────────
    'polyester fabric': ['microfiber fabric', 'fleece fabric', 'nylon fabric', 'synthetic fabric'],
    'lace fabric': ['cotton lace', 'guipure lace', 'stretch lace', 'bridal lace'],
    'velvet fabric': ['velour fabric', 'plush fabric', 'velveteen'],
    'denim fabric': ['denim cloth', 'jean fabric', 'indigo denim'],
    // ── Watches more → chapter 91 ─────────────────────────────────────────────
    'mechanical watch': ['automatic watch', 'self-winding watch', 'luxury watch'],
    'quartz watch': ['battery watch', 'analog quartz', 'digital quartz watch'],
    // ── Musical instruments more → chapter 92 ─────────────────────────────────
    'midi keyboard': ['digital piano keyboard', 'electronic music keyboard', 'piano controller'],
    synthesizer: ['synth', 'analog synthesizer', 'digital synthesizer', 'music synthesizer'],
    'accordion': ['piano accordion', 'button accordion', 'squeezebox'],
    harmonica: ['mouth organ', 'blues harp', 'diatonic harmonica', 'chromatic harmonica'],
    'music box': ['musical box', 'wind-up music box', 'decorative music box'],
    // ── Collectibles → chapter 97 ─────────────────────────────────────────────
    'trading card': ['pokemon card', 'sports card', 'collectible card', 'baseball card'],
    'model kit': ['plastic model kit', 'scale model', 'gundam kit', 'miniature model'],
    'vinyl figure': ['pop figure', 'funko pop', 'collectible figure', 'vinyl toy'],
    // ── Coins & stamps → chapter 97 ───────────────────────────────────────────
    'gold coin': ['silver coin', 'commemorative coin', 'bullion coin', 'numismatic coin'],
    // ── Luggage more → chapter 42 ─────────────────────────────────────────────
    'packing cube': ['travel organizer', 'luggage organizer', 'packing organizer'],
    'travel adapter': ['universal adapter', 'power plug adapter', 'international adapter'],
    // ── Tools more → chapter 84/82 ────────────────────────────────────────────
    'angle grinder': ['grinder tool', 'disc grinder', 'bench grinder', 'hand grinder'],
    'reciprocating saw': ['sabre saw', 'scroll saw', 'jig saw power tool'],
    'nail gun': ['brad nailer', 'framing nailer', 'staple gun', 'pneumatic nailer'],
    'level tool': ['spirit level', 'bubble level', 'laser level', 'torpedo level'],
    'stud finder': ['wall scanner', 'metal detector stud', 'electronic stud finder'],
    // ── Decorative items → chapter 44/49/69 ───────────────────────────────────
    'picture frame': ['photo frame', 'wall frame', 'art frame', 'shadow box'],
    'scented candle': ['soy candle', 'beeswax candle', 'jar candle', 'pillar candle'],
    'wind chime': ['garden chime', 'outdoor chime', 'hanging chime'],
    'dreamcatcher': ['dream catcher', 'boho decor', 'wall hanging dreamcatcher'],
    // ── Finance / office → chapter 84 ─────────────────────────────────────────
    'cash register': ['pos terminal', 'point of sale', 'retail register', 'receipt printer'],
    'laminator': ['laminating machine', 'document laminator', 'photo laminator'],
    'paper shredder': ['office shredder', 'document destroyer', 'micro cut shredder'],
    // ── Eyewear → chapter 90 ──────────────────────────────────────────────────
    'blue light glasses': ['computer glasses', 'anti-blue light', 'screen glasses'],
    'night driving glasses': ['yellow lens glasses', 'anti-glare glasses', 'driving glasses'],
    // ── Apparel care → chapter 84/85 ──────────────────────────────────────────
    'lint roller': ['lint brush', 'fabric roller', 'clothes roller'],
    'clothes steamer': ['garment steamer', 'handheld steamer', 'fabric steamer'],
    // ── Shoe care → chapter 34/96 ─────────────────────────────────────────────
    'shoe polish': ['boot polish', 'leather polish', 'shoe shine', 'shoe wax'],
    'shoe insert': ['insole', 'foot insole', 'arch support', 'orthotic insole'],
    // ── Hats more → chapter 65 ────────────────────────────────────────────────
    'panama hat': ['felt hat wide brim', 'straw sun hat', 'pork pie hat'],
    'bucket hat': ['fisherman hat', 'sun hat', 'outdoor hat', 'boonie hat'],
    // ── Bags more → chapter 42 ────────────────────────────────────────────────
    'clutch bag': ['clutch purse', 'evening clutch', 'envelope clutch', 'wristlet'],
    'crossbody bag': ['crossbody purse', 'sling bag', 'shoulder crossbody', 'mini crossbody'],
    // ── Jewelry more → chapter 71 ─────────────────────────────────────────────
    'anklet': ['ankle bracelet', 'foot jewelry', 'ankle chain'],
    'body piercing': ['nose ring', 'belly button ring', 'septum ring', 'cartilage ring'],
    // ── Food & Beverages ──────────────────────────────────────────────────────
    'bread': ['white bread', 'whole wheat bread', 'sourdough loaf', 'baguette', 'dinner roll', 'pita bread', 'rye bread'],
    'rice': ['white rice', 'brown rice', 'jasmine rice', 'basmati rice', 'arborio rice', 'wild rice', 'long grain rice'],
    'cooking oil': ['vegetable oil', 'sunflower oil', 'canola oil', 'corn oil', 'palm oil', 'sesame oil', 'coconut oil'],
    'olive oil': ['extra virgin olive oil', 'light olive oil', 'pure olive oil', 'cold pressed olive oil'],
    'sauce': ['hot sauce', 'tomato sauce', 'soy sauce', 'barbecue sauce', 'worcestershire sauce', 'oyster sauce', 'fish sauce'],
    'cereal': ['breakfast cereal', 'oat cereal', 'corn flakes', 'granola', 'muesli', 'puffed rice', 'bran flakes'],
    'snack': ['potato chips', 'tortilla chips', 'popcorn', 'pretzels', 'crackers', 'trail mix', 'rice cake'],
    'coffee beans': ['roasted coffee beans', 'arabica coffee', 'robusta coffee', 'espresso beans', 'whole bean coffee'],
    'tea leaves': ['green tea', 'black tea', 'oolong tea', 'herbal tea', 'chamomile tea', 'peppermint tea', 'loose leaf tea'],
    'protein powder': ['whey protein', 'plant protein', 'casein protein', 'protein supplement', 'protein shake powder'],
    // ── Electronics & Smart Home ──────────────────────────────────────────────
    'projector screen': ['projection screen', 'pull down screen', 'fixed frame screen', 'motorized screen', 'outdoor screen'],
    'barcode scanner': ['barcode reader', 'qr code scanner', 'handheld scanner', 'laser scanner', 'pos scanner', 'barcode gun'],
    'label maker': ['label machine', 'dymo type label', 'thermal label writer', 'tape label maker', 'embossing label maker'],
    'smart home hub': ['home automation hub', 'zigbee hub', 'zwave hub', 'smart gateway', 'home controller', 'smart bridge'],
    'smart sensor': ['temperature sensor', 'humidity sensor', 'smart occupancy sensor', 'smart detector', 'flood sensor'],
    'smart plug': ['wifi plug', 'smart outlet', 'wifi smart switch', 'smart power strip', 'timer plug', 'energy monitor plug'],
    'smart bulb': ['led smart bulb', 'wifi light bulb', 'color changing bulb', 'smart light', 'dimmable smart bulb'],
    'security camera': ['ip camera', 'cctv camera', 'surveillance camera', 'doorbell camera', 'outdoor camera', 'dome camera'],
    'video doorbell': ['smart doorbell', 'wifi doorbell', 'doorbell with camera', 'doorbell intercom camera'],
    'action camera': ['sports camera', 'waterproof action cam', 'helmet camera', 'adventure camera', 'sports action cam'],
    'document camera': ['doc cam', 'overhead document scanner', 'book scanner camera', 'visualizer camera'],
    'oscilloscope': ['digital oscilloscope', 'handheld oscilloscope', 'bench oscilloscope', 'signal analyzer'],
    'robot vacuum': ['robotic vacuum', 'auto vacuum robot', 'self emptying robot vacuum', 'vacuum robot mop'],
    'air purifier': ['hepa air purifier', 'room air purifier', 'desktop air purifier', 'air cleaner', 'ionic air purifier'],
    'electric toothbrush': ['sonic toothbrush', 'rotating toothbrush', 'rechargeable toothbrush', 'powered toothbrush'],
    // ── Automotive ────────────────────────────────────────────────────────────
    'car wash': ['car wash soap', 'auto shampoo', 'car cleaning kit', 'foam cannon soap', 'vehicle wash'],
    'car polish': ['car wax', 'auto polish', 'paint sealant', 'car detailing wax', 'swirl remover', 'paint polish'],
    'car seat cover': ['seat protector', 'auto seat cover', 'vehicle seat cover', 'leather seat cover', 'neoprene seat cover'],
    'car floor mat': ['auto floor mat', 'rubber car mat', 'all weather floor mat', 'cargo mat', 'trunk liner mat'],
    'car air freshener': ['auto air freshener', 'car deodorizer', 'vent clip freshener', 'hanging air freshener car'],
    'wiper blade': ['windshield wiper blade', 'beam wiper blade', 'rear wiper blade', 'rain wiper insert'],
    'car charger': ['auto charger', 'vehicle charger', 'cigarette lighter charger', 'usb car adapter', '12v car charger'],
    'dash cam': ['dashboard camera', 'car dvr', 'driving recorder', 'front dash camera', 'dual dash cam'],
    'jumper cables': ['booster cables', 'jump starter cables', 'battery jump cables', 'car battery cables', 'jumper leads'],
    'tire gauge': ['tyre pressure gauge', 'digital tire pressure gauge', 'tire air gauge', 'automotive pressure meter'],
    'car cover': ['vehicle cover', 'waterproof car cover', 'auto cover', 'outdoor car cover', 'full car cover'],
    'steering wheel cover': ['leather steering cover', 'grip steering wheel cover', 'anti-slip wheel cover'],
    // ── Apparel ───────────────────────────────────────────────────────────────
    'rain jacket': ['waterproof jacket', 'raincoat', 'windbreaker jacket', 'rain shell', 'waterproof shell coat'],
    'puffer jacket': ['down jacket', 'quilted jacket', 'puffer coat', 'down coat', 'insulated jacket', 'bubble jacket'],
    'denim jacket': ['jean jacket', 'trucker jacket', 'denim coat', 'stonewash denim jacket'],
    'overalls': ['bib overalls', 'dungarees', 'work overalls', 'denim overalls', 'bib pants'],
    'jumpsuit': ['romper', 'one piece outfit', 'boilersuit', 'playsuit', 'all in one jumpsuit'],
    'sports bra': ['athletic bra', 'yoga bra', 'running bra', 'gym bra', 'workout bra', 'compression bra'],
    'polo shirt': ['polo tee', 'golf shirt', 'pique polo', 'collared polo shirt', 'performance polo'],
    // ── Furniture & Home ──────────────────────────────────────────────────────
    'tv stand': ['media console', 'entertainment center', 'tv cabinet', 'tv unit', 'media stand', 'entertainment unit'],
    'shoe rack': ['shoe shelf', 'shoe organizer', 'shoe cabinet', 'entryway shoe rack', 'boot rack', 'shoe storage'],
    'hat rack': ['hat stand', 'cap rack', 'hat holder', 'wall hat rack', 'cap organizer'],
    'coat rack': ['coat stand', 'hall tree', 'entryway rack', 'clothes rack', 'garment stand'],
    'murphy bed': ['wall bed', 'fold down bed', 'hideaway bed', 'cabinet bed', 'space saving bed'],
    'futon': ['futon sofa', 'futon couch', 'sleeper sofa', 'fold out sofa bed', 'pull out couch'],
    'recliner': ['recliner chair', 'power recliner chair', 'rocker recliner', 'massage recliner chair'],
    'ottoman': ['footstool', 'storage ottoman', 'coffee table ottoman', 'pouf ottoman', 'tufted ottoman'],
    'accent chair': ['armchair', 'barrel chair', 'side chair', 'living room chair', 'wingback chair'],
    'bar stool': ['counter stool', 'kitchen stool', 'swivel bar stool', 'breakfast bar stool', 'island stool'],
    'vanity table': ['makeup vanity', 'dressing table', 'vanity desk', 'makeup table with mirror'],
    'floating shelf': ['wall shelf', 'wall mounted shelf', 'display shelf', 'picture ledge', 'wood wall shelf'],
    'bookcase': ['bookshelf', 'shelving unit', 'etagere', 'open bookcase', 'storage bookshelf'],
    'coffee table': ['living room table', 'lounge table', 'center table', 'cocktail table', 'trunk coffee table'],
    'side table': ['end table', 'accent table', 'nightstand side table', 'sofa side table'],
    // ── Cleaning & Household ──────────────────────────────────────────────────
    'vacuum bags': ['dust bags', 'vacuum cleaner bags', 'hoover bags', 'replacement bags for vacuum'],
    'air freshener': ['room spray', 'fabric deodorizer spray', 'odor eliminator', 'reed diffuser', 'plug in freshener'],
    'glass cleaner': ['window cleaner', 'mirror cleaner', 'streak free glass cleaner', 'windshield cleaner'],
    'toilet cleaner': ['bowl cleaner', 'toilet bowl cleaner', 'toilet disinfectant', 'bathroom bowl cleaner'],
    'dish soap': ['dishwashing liquid', 'dish detergent', 'washing up liquid', 'hand dish soap', 'dish wash'],
    'disinfectant': ['sanitizer spray', 'antibacterial spray', 'surface disinfectant', 'bleach cleaner', 'antiviral cleaner'],
    'trash bag': ['garbage bag', 'bin liner', 'waste bag', 'plastic garbage bag', 'heavy duty trash bag', 'refuse bag'],
    'mop bucket': ['wringer bucket', 'mop and bucket set', 'floor mop bucket', 'spin mop bucket'],
    'cleaning cloth': ['microfiber cloth', 'dish cloth', 'lint free cloth', 'cleaning rag', 'all purpose cloth'],
    // ── Health & Medical ──────────────────────────────────────────────────────
    'knee brace': ['knee support', 'knee wrap', 'knee stabilizer', 'patella brace', 'athletic knee brace', 'knee sleeve'],
    'back brace': ['lumbar support belt', 'back support brace', 'posture corrector brace', 'lumbar brace'],
    'ankle brace': ['ankle support brace', 'ankle wrap', 'ankle stabilizer', 'ankle splint', 'ankle sleeve'],
    'wrist brace': ['wrist support brace', 'wrist splint', 'wrist wrap', 'carpal tunnel brace', 'wrist guard'],
    'heating pad': ['electric heating pad', 'heat therapy pad', 'heat wrap', 'far infrared pad', 'warming pad'],
    'tens unit': ['tens machine', 'electrical muscle stimulator', 'ems device', 'pain relief tens', 'nerve stimulator'],
    'pulse oximeter': ['oxygen monitor', 'blood oxygen meter', 'spo2 monitor', 'fingertip pulse oximeter'],
    'stethoscope': ['medical stethoscope', 'cardiology stethoscope', 'nurse stethoscope', 'acoustic stethoscope'],
    'blood pressure monitor': ['bp monitor', 'blood pressure cuff', 'digital bp machine', 'home bp monitor'],
    'cpap machine': ['sleep apnea device', 'cpap device', 'bipap machine', 'sleep therapy device', 'auto cpap'],
    'rollator walker': ['rolling walker', 'walker with wheels', 'four wheel walker', 'folding rollator', 'wheeled walker'],
    'eye drops': ['artificial tears', 'lubricating eye drops', 'allergy eye drops', 'ophthalmic solution'],
    // ── Toys & Games ─────────────────────────────────────────────────────────
    'remote control car': ['rc car', 'radio controlled car', 'remote car toy', '4wd rc car', 'drift rc car'],
    'toy drone': ['kids drone', 'mini quadcopter toy', 'beginner drone toy', 'indoor drone', 'nano drone'],
    'water gun': ['squirt gun', 'water pistol', 'water blaster toy', 'super soaker type', 'water shooter'],
    'foam sword': ['pool noodle sword', 'foam weapon toy', 'soft sword toy', 'foam battle sword'],
    'kite': ['diamond kite', 'delta kite', 'box kite', 'stunt kite', 'kids kite', 'flying kite'],
    'board game': ['family board game', 'strategy board game', 'tabletop game', 'party board game', 'cooperative game'],
    'action figure': ['superhero figure', 'collectible action figure', 'poseable figure', 'anime figure', 'toy soldier'],
    'stuffed animal': ['plush toy animal', 'teddy bear', 'plush stuffed animal', 'soft toy animal', 'stuffed bear'],
    'building blocks': ['lego type blocks', 'snap blocks', 'construction blocks', 'stacking blocks', 'interlocking blocks'],
    'marble run': ['marble track', 'marble maze', 'marble race set', 'ball run toy', 'marble game'],
    'play dough': ['modeling clay toy', 'playdoh type', 'kinetic sand', 'moldable clay toy', 'air dry clay set'],
    'fidget spinner': ['hand spinner', 'fidget toy', 'stress spinner', 'tri spinner', 'spin toy'],
    'yo yo': ['yoyo', 'yo-yo toy', 'professional yoyo', 'trick yoyo', 'looping yoyo'],
    // ── Stationery & Office ───────────────────────────────────────────────────
    'fountain pen': ['ink pen calligraphy', 'nib pen', 'refillable fountain pen', 'calligraphy fountain pen'],
    'mechanical pencil': ['propelling pencil', 'automatic pencil', 'click pencil', 'drafting mechanical pencil'],
    'gel pen': ['ink gel pen', 'rollerball gel pen', 'smooth writing gel pen', 'colored gel pens set'],
    'whiteboard marker': ['dry erase marker', 'board marker', 'erasable whiteboard marker', 'expo type marker'],
    'paper clip': ['binder clip', 'fold back clip', 'bulldog clip', 'jumbo binder clip', 'mini paper clips'],
    'hole punch': ['paper hole punch', '3 hole punch', 'single hole punch', 'paper perforator tool'],
    'desk organizer': ['pen holder', 'desk tray organizer', 'office stationery organizer', 'desktop caddy'],
    'file folder': ['manila folder', 'hanging file folder', 'document folder', 'poly folder', 'accordion folder'],
    'index card': ['flash card', '3x5 index card', 'study cards', 'note card', 'ruled index cards'],
    'correction tape': ['correction roller', 'white out tape', 'correction pen tape', 'liquid tape corrector'],
    'rubber eraser': ['pencil eraser', 'vinyl eraser', 'kneaded eraser', 'block eraser', 'art eraser'],
    // ── Cosmetics & Beauty ────────────────────────────────────────────────────
    'setting spray': ['makeup setting spray', 'face mist spray', 'finishing spray', 'makeup fixer spray'],
    'primer': ['face primer', 'makeup primer base', 'pore minimizing primer', 'eye primer', 'foundation primer'],
    'eyebrow pencil': ['brow pencil', 'eyebrow pen', 'brow definer pencil', 'micro brow pencil', 'eyebrow filler'],
    'lip liner': ['lipliner pencil', 'lip contour pencil', 'lip definer', 'lip pencil', 'lipliner pen'],
    'nail art': ['nail stickers', 'nail decals', 'nail stamps', 'nail foil', 'nail art wraps'],
    'false lashes': ['fake eyelashes', 'strip lashes', 'individual lashes', 'magnetic lashes', 'lash kit'],
    'beauty blender': ['makeup sponge', 'foundation sponge', 'applicator sponge', 'beauty egg sponge'],
    'lip balm': ['chapstick', 'lip moisturizer', 'tinted lip balm', 'lip butter', 'beeswax lip balm'],
    'nail polish': ['nail lacquer', 'gel nail polish', 'nail varnish', 'nail color', 'nail enamel'],
    // ── Baby & Kids ───────────────────────────────────────────────────────────
    'baby swing': ['infant swing', 'baby bouncer swing', 'baby rocker', 'electric baby swing', 'portable baby swing'],
    'play mat': ['baby gym mat', 'activity play mat', 'tummy time mat', 'foam play mat', 'baby floor mat'],
    'baby gate': ['safety gate', 'stair gate', 'child safety gate', 'pet gate baby', 'pressure mount baby gate'],
    'baby monitor': ['video baby monitor', 'audio baby monitor', 'smart baby monitor', 'wifi baby camera'],
    'baby carrier': ['baby wrap carrier', 'ring sling', 'soft structured carrier', 'ergonomic baby carrier'],
    'high chair': ['baby high chair', 'feeding high chair', 'convertible high chair', 'booster feeding seat'],
    'baby wipes': ['diaper wipes', 'wet wipes', 'unscented baby wipes', 'sensitive baby wipes'],
    'car seat': ['infant car seat', 'booster car seat', 'convertible car seat', 'toddler car seat', 'child car seat'],
    'baby food': ['infant food', 'baby puree', 'stage 1 baby food', 'organic baby food', 'baby cereal'],
    'teether': ['baby teether', 'silicone teether', 'teething ring', 'teething toy', 'chilled teether'],
    // ── Musical Instruments ───────────────────────────────────────────────────
    'capo': ['guitar capo', 'capo clip', 'trigger capo', 'partial capo', 'acoustic capo'],
    'chromatic tuner': ['clip on tuner', 'digital guitar tuner', 'pedal tuner', 'chromatic instrument tuner'],
    'instrument cable': ['guitar cable', 'trs cable', 'patch cable', 'instrument lead', 'audio instrument cable'],
    'violin bow': ['fiddle bow', 'cello bow', 'brazilwood bow', 'fiberglass violin bow', 'horsehair bow'],
    'piano keyboard': ['digital piano keyboard', 'electric keyboard', 'portable piano keyboard', 'midi piano'],
    'microphone stand': ['mic stand', 'boom mic stand', 'floor mic stand', 'desk mic stand', 'adjustable mic stand'],
    'drum pad': ['practice drum pad', 'electronic drum pad', 'rubber drum pad', 'training drum pad'],
    // ── Garden & Outdoor ──────────────────────────────────────────────────────
    'garden hose': ['water hose', 'expandable garden hose', 'flat hose', 'retractable garden hose', 'hose pipe'],
    'sprinkler': ['garden sprinkler', 'oscillating sprinkler', 'impact sprinkler', 'lawn sprinkler', 'rotating sprinkler'],
    'plant pot': ['flower pot', 'planter pot', 'ceramic plant pot', 'terracotta pot', 'hanging planter', 'window box'],
    'garden trowel': ['hand trowel', 'transplanting trowel', 'weeding trowel', 'hand spade', 'garden digging tool'],
    'watering can': ['plant watering can', 'metal watering can', 'indoor watering can', 'garden watering can'],
    'fertilizer': ['plant food', 'garden fertilizer', 'organic fertilizer', 'slow release fertilizer', 'liquid fertilizer'],
    'seeds': ['vegetable seeds', 'flower seeds', 'herb seeds', 'seed packet', 'garden seeds', 'seed variety pack'],
    'pruning shears': ['pruning scissors', 'hand pruner', 'secateurs', 'garden clippers', 'bypass pruner'],
    'garden gloves': ['work gloves gardening', 'rubber gardening gloves', 'leather garden gloves', 'nitrile garden gloves'],
    'watering nozzle': ['hose nozzle', 'adjustable nozzle', 'spray nozzle', 'garden spray head', 'watering wand'],
    'lawn mower': ['grass cutter', 'push lawn mower', 'electric lawn mower', 'cordless mower', 'robot lawn mower'],
    'wheelbarrow': ['garden wheelbarrow', 'yard cart', 'garden cart', 'poly wheelbarrow', 'heavy duty barrow'],
    'garden edger': ['lawn edger', 'string trimmer', 'weed eater', 'grass trimmer electric'],
    // ── Pet Supplies ──────────────────────────────────────────────────────────
    'dog bed': ['pet dog bed', 'orthopedic dog bed', 'calming dog bed', 'elevated dog bed', 'washable dog bed'],
    'cat tree': ['cat tower', 'cat condo', 'cat climbing tree', 'multi level cat tower', 'sisal cat tree'],
    'fish tank': ['aquarium tank', 'fish aquarium', 'planted aquarium', 'freshwater tank', 'nano aquarium'],
    'pet collar': ['dog collar', 'cat collar', 'breakaway collar', 'safety collar', 'reflective pet collar'],
    'dog leash': ['pet leash', 'retractable dog leash', 'nylon dog leash', 'leather dog leash', 'slip lead'],
    'cat litter': ['kitty litter', 'clumping cat litter', 'crystal litter', 'natural cat litter', 'litter pellets'],
    'litter box': ['cat litter box', 'self cleaning litter box', 'covered litter box', 'litter tray'],
    'dog harness': ['no pull harness', 'step in harness', 'vest harness', 'adjustable dog harness', 'puppy harness'],
    'pet food bowl': ['dog bowl', 'cat bowl', 'slow feeder bowl', 'elevated food bowl', 'stainless food bowl'],
    'aquarium filter': ['fish tank filter', 'canister filter', 'hang on back filter', 'internal aquarium filter'],
    'hamster cage': ['small animal cage', 'guinea pig cage', 'rabbit hutch', 'rodent cage', 'gerbil cage'],
    // ── Textiles & Bedding ────────────────────────────────────────────────────
    'tablecloth': ['table cover', 'dining tablecloth', 'vinyl tablecloth', 'linen tablecloth', 'table linen'],
    'kitchen towel': ['dish towel', 'hand towel kitchen', 'dish cloth kitchen', 'flour sack towel'],
    'bath towel': ['bath sheet', 'shower towel', 'cotton bath towel', 'microfiber bath towel', 'quick dry bath towel'],
    'doormat': ['welcome mat', 'entry mat', 'coir doormat', 'rubber doormat', 'outdoor doormat', 'door rug'],
    'pillow cover': ['pillowcase', 'pillow sham', 'cushion cover', 'throw pillow cover', 'decorative pillowcase'],
    'duvet cover': ['comforter cover', 'quilt cover', 'duvet bedding set', 'nordic duvet cover'],
    // ── Industrial & Hardware ─────────────────────────────────────────────────
    'drill bit': ['twist drill bit', 'masonry drill bit', 'wood drill bit', 'step drill bit', 'forstner bit', 'cobalt bit'],
    'chain': ['roller chain', 'link chain', 'tow chain', 'security chain', 'anchor chain', 'stainless chain'],
    'spring': ['compression spring', 'extension spring', 'torsion spring', 'coil spring', 'return spring'],
    'conveyor belt': ['flat belt conveyor', 'modular conveyor belt', 'timing belt conveyor', 'rubber conveyor belt'],
    'hydraulic cylinder': ['hydraulic ram', 'hydraulic piston', 'linear hydraulic actuator', 'hydraulic jack'],
    'grinding wheel': ['abrasive grinding wheel', 'bench grinder wheel', 'cutting disc', 'flap disc', 'grinding disc'],
    'soldering iron': ['soldering station', 'desoldering tool', 'solder pencil', 'hakko type iron', 'weller type iron'],
    'rivet': ['pop rivet', 'blind rivet', 'solid rivet', 'structural rivet', 'rivets assortment'],
    'tap and die': ['threading tool', 'tap die set', 'thread cutter', 'pipe tap set', 'metric tap set'],
    'torque wrench': ['click torque wrench', 'digital torque wrench', 'beam torque wrench', 'preset torque wrench'],
    'impact driver': ['cordless impact driver', 'impact screwdriver', 'power impact driver', 'brushless impact driver'],
    // ── Lighting ─────────────────────────────────────────────────────────────
    'ceiling light': ['overhead light', 'flush mount light', 'semi flush light', 'ceiling fixture', 'ceiling lamp'],
    'fairy lights': ['string lights', 'twinkle lights', 'christmas string lights', 'solar string lights', 'party lights'],
    'flashlight': ['led torch', 'tactical flashlight', 'rechargeable flashlight', 'pocket flashlight', 'emergency torch'],
    'solar light': ['solar garden light', 'solar path light', 'solar stake light', 'outdoor solar lamp', 'solar spotlight'],
    'night light': ['plug in night light', 'led night light', 'motion sensor night light', 'nursery night light'],
    'grow light': ['plant grow light', 'led grow light', 'full spectrum grow light', 'indoor grow lamp', 'hydroponic light'],
    'work light': ['job site light', 'portable work light', 'led work lamp', 'flood work light', 'construction light'],
    // ── Storage & Organization ────────────────────────────────────────────────
    'storage bin': ['storage box', 'plastic storage bin', 'stackable storage bin', 'tote bin', 'container bin'],
    'drawer organizer': ['drawer divider', 'silverware organizer tray', 'utensil organizer', 'drawer insert divider'],
    'closet organizer': ['closet system', 'wardrobe organizer', 'hanging closet organizer', 'shelf divider closet'],
    'over door organizer': ['door rack organizer', 'over door rack', 'back of door organizer', 'pantry door rack'],
    'vacuum storage bag': ['space saver bag', 'compression storage bag', 'vacuum seal bag clothes', 'space bag'],
    'shelf liner': ['drawer liner', 'cabinet liner', 'non slip shelf liner', 'refrigerator liner', 'grip shelf liner'],
    'cable organizer': ['cable management', 'cord organizer', 'cable clips', 'wire organizer', 'cord holder'],
    // ── Sports & Fitness more ─────────────────────────────────────────────────
    'resistance band': ['exercise band', 'loop resistance band', 'stretch band', 'therapy band', 'latex resistance band'],
    'yoga block': ['foam yoga block', 'cork yoga block', 'yoga prop block', 'meditation block'],
    'foam roller': ['muscle foam roller', 'massage foam roller', 'trigger point roller', 'recovery roller'],
    'jump rope': ['skipping rope', 'speed jump rope', 'weighted jump rope', 'adjustable skip rope'],
    'battle rope': ['exercise rope', 'thick battle rope', 'fitness training rope', 'anchor battle rope'],
    'agility ladder': ['speed ladder', 'agility training ladder', 'footwork ladder', 'quickness ladder'],
    'weight bench': ['flat weight bench', 'adjustable weight bench', 'utility bench', 'olympic bench'],
    'medicine ball': ['wall ball', 'slam ball', 'weighted exercise ball', 'training medicine ball'],
    'kettlebell': ['cast iron kettlebell', 'vinyl kettlebell', 'adjustable kettlebell', 'competition kettlebell'],
    // ── Gaming & PC Peripherals ───────────────────────────────────────────────
    'gaming chair': ['gaming seat', 'racing chair', 'ergonomic gaming chair', 'pc gaming chair', 'esports chair'],
    'gaming headset': ['gaming headphones', 'stereo gaming headset', 'wireless gaming headset', '7.1 surround headset'],
    'gaming mouse': ['optical gaming mouse', 'wireless gaming mouse', 'rgb gaming mouse', 'laser gaming mouse'],
    'gaming keyboard': ['mechanical gaming keyboard', 'rgb gaming keyboard', 'tenkeyless gaming board', 'wireless gaming kb'],
    'bluetooth speaker': ['portable bluetooth speaker', 'wireless speaker', 'waterproof bt speaker', 'mini bt speaker'],
    'smart tv': ['android tv', 'smart television', 'qled tv', 'oled tv', '4k smart tv', 'fire tv stick'],
    'e-reader': ['ebook reader', 'kindle type reader', 'digital book reader', 'e-ink reader', 'electronic book'],
    'hdmi cable': ['hdmi cord', '4k hdmi cable', 'high speed hdmi', 'hdmi 2.1 cable', 'hdmi adapter cable'],
    'usb hub': ['usb splitter', 'usb port hub', '4 port usb hub', 'usb c hub', 'multiport usb hub'],
    'power bank': ['portable charger bank', 'battery pack', 'portable power bank', 'external battery bank'],
    'hard drive': ['external hard drive', 'portable hdd', 'desktop hard drive', 'external hdd', 'usb hard drive'],
    'graphics card': ['gpu card', 'video card', 'gaming gpu', 'display card', 'discrete graphics'],
    'laptop cooler': ['laptop cooling pad', 'notebook cooler', 'laptop cooling fan', 'cooling stand laptop'],
    'wrist rest': ['keyboard wrist rest', 'mouse wrist pad', 'gel wrist support', 'ergonomic wrist cushion'],
    'ergonomic chair': ['office ergonomic chair', 'mesh office chair', 'lumbar support chair', 'adjustable desk chair'],
    // ── Kitchen Appliances ────────────────────────────────────────────────────
    'air fryer': ['air fryer oven', 'compact air fryer', 'basket air fryer', 'digital air fryer', 'oil free fryer'],
    'slow cooker': ['crockpot', 'crock pot slow cooker', 'programmable slow cooker', 'oval slow cooker'],
    'rice cooker': ['electric rice cooker', 'digital rice cooker', 'fuzzy logic rice cooker', 'rice steamer'],
    'electric kettle': ['electric tea kettle', 'variable temp kettle', 'gooseneck electric kettle', 'cordless kettle'],
    'coffee maker': ['drip coffee maker', 'programmable coffee maker', 'single serve coffee maker', 'pour over maker'],
    'hand mixer': ['electric hand mixer', 'handheld beater mixer', '5 speed hand mixer', 'electric beater'],
    'food processor': ['kitchen food processor', 'mini food processor', 'chopper food processor', 'blender processor'],
    'juicer': ['centrifugal juicer', 'masticating juicer', 'cold press juicer', 'slow juicer', 'citrus squeezer'],
    'food dehydrator': ['dehydrator machine', 'food dryer', 'jerky dehydrator', 'fruit and vegetable dehydrator'],
    'cutting board': ['chopping board', 'bamboo chopping board', 'plastic cutting board', 'wooden cutting board'],
    'can opener': ['electric can opener', 'manual can opener', 'smooth edge opener', 'jar and can opener'],
    'kitchen scale': ['digital food scale', 'cooking scale', 'baking kitchen scale', 'postal kitchen scale'],
    'travel mug': ['insulated travel mug', 'commuter coffee mug', 'thermos travel mug', 'tumbler travel mug'],
    // ── Apparel & Footwear ────────────────────────────────────────────────────
    'running shoes': ['jogging shoes', 'trail running shoes', 'road running shoes', 'marathon running shoe'],
    'flip flops': ['thong sandals', 'beach sandals', 'foam flip flops', 'rubber flip flops', 'beach slides'],
    'winter coat': ['heavy winter coat', 'wool overcoat', 'long winter coat', 'parka winter coat', 'trench coat'],
    'baseball cap': ['dad hat', 'snapback cap', 'trucker cap', 'baseball hat', 'fitted baseball cap'],
    'compression socks': ['graduated compression stockings', 'medical compression socks', 'support compression socks'],
    // ── Sports & Fitness ─────────────────────────────────────────────────────
    'yoga mat': ['non slip yoga mat', 'thick yoga mat', 'exercise yoga mat', 'rubber yoga mat', 'tpe yoga mat'],
    'swimming goggles': ['anti fog swim goggles', 'competition swim goggles', 'open water goggles', 'triathlon goggles'],
    'bike helmet': ['cycling helmet', 'mountain bike helmet', 'road bike helmet', 'kids bicycle helmet'],
    'exercise bike': ['stationary bike', 'spin bike', 'indoor cycling bike', 'recumbent exercise bike'],
    'rowing machine': ['rower machine', 'water rower', 'air rowing machine', 'magnetic rower', 'ergometer rower'],
    'elliptical': ['elliptical machine', 'cross trainer elliptical', 'elliptical trainer', 'stride trainer'],
    'shin guards': ['soccer shin guards', 'football shin pads', 'field hockey shin guards', 'leg shin pads'],
    'basketball': ['indoor basketball', 'outdoor basketball', 'rubber basketball', 'leather basketball'],
    'soccer ball': ['football ball', 'futsal ball', 'training soccer ball', 'youth soccer ball'],
    'football': ['american football', 'gridiron ball', 'pro football', 'youth leather football'],
    'baseball glove': ['fielding glove', 'outfield glove', 'first base mitt', 'catcher mitt', 'softball glove'],
    'golf bag': ['golf stand bag', 'cart golf bag', 'carry golf bag', 'tour golf bag'],
    'hiking poles': ['trekking poles', 'collapsible hiking poles', 'carbon trekking poles', 'nordic walking poles'],
    'life jacket': ['personal flotation device', 'pfd vest', 'buoyancy aid', 'inflatable life jacket'],
    'roller skates': ['quad roller skates', 'roller derby skates', 'artistic roller skates', 'outdoor roller skates'],
    'skateboard deck': ['complete skateboard', 'longboard skateboard', 'cruiser skateboard', 'trick skateboard'],
    'ice skates': ['figure ice skates', 'hockey ice skates', 'recreational ice skates', 'speed ice skates'],
    'snowshoes': ['backcountry snowshoes', 'aluminum snowshoes', 'composite snowshoes', 'winter snowshoes'],
    'pool table': ['billiard table', 'snooker table', 'slate pool table', 'foosball table', 'bar pool table'],
    'billiard balls': ['pool balls set', 'snooker balls', 'cue ball', 'billiard ball set'],
    'chess set': ['wooden chess set', 'travel chess set', 'magnetic chess set', 'luxury chess board set'],
    // ── Outdoor & Camping ─────────────────────────────────────────────────────
    'camping tent': ['backpacking tent', 'family camping tent', 'dome tent', 'cabin tent', 'instant pop up tent'],
    'sleeping bag': ['camping sleeping bag', 'mummy sleeping bag', 'rectangular sleeping bag', 'ultralight bag'],
    'fishing rod': ['spinning fishing rod', 'casting rod', 'fly fishing rod', 'telescopic fishing rod'],
    'fishing line': ['monofilament fishing line', 'fluorocarbon line', 'braided fishing line', 'fishing wire'],
    // ── Tools & Hardware ──────────────────────────────────────────────────────
    'measuring tape': ['tape measure', 'retractable tape measure', 'steel tape measure', 'metric tape measure'],
    'sandpaper': ['sanding paper', 'abrasive sandpaper', 'wet dry sandpaper', 'sanding block', 'sandpaper sheets'],
    'circular saw': ['cordless circular saw', 'worm drive saw', 'corded circular saw', 'track saw blade'],
    'air compressor': ['portable air compressor', 'pancake compressor', 'oil free compressor', 'belt drive compressor'],
    'socket set': ['socket wrench set', 'ratchet socket set', 'impact socket set', 'metric socket set'],
    'allen wrench': ['hex key', 'hex key set', 'allen key set', 'ball end hex key', 'metric hex wrench'],
    'paint roller': ['roller brush', 'foam paint roller', 'nap roller', 'extension pole roller'],
    'wood stain': ['deck stain', 'exterior wood stain', 'interior wood stain', 'gel stain', 'penetrating wood stain'],
    // ── Automotive ────────────────────────────────────────────────────────────
    'motor oil': ['engine oil', 'synthetic motor oil', 'full synthetic oil', 'conventional motor oil'],
    'brake pads': ['disc brake pads', 'ceramic brake pads', 'semi metallic brake pads', 'front brake pads'],
    // ── HVAC & Climate ────────────────────────────────────────────────────────
    'ceiling fan': ['room ceiling fan', 'outdoor ceiling fan', 'ceiling fan with light', 'dc ceiling fan'],
    'box fan': ['window box fan', 'floor box fan', 'square cooling fan', 'reversible box fan'],
    'tower fan': ['oscillating tower fan', 'slim tower fan', 'cooling tower fan', 'bladeless tower fan'],
    'space heater': ['portable electric heater', 'ceramic space heater', 'infrared space heater', 'oil filled radiator'],
    'desk fan': ['usb desk fan', 'personal desk fan', 'oscillating desk fan', 'mini desk fan', 'clip fan'],
    // ── Bathroom & Home Fixtures ──────────────────────────────────────────────
    'shower curtain': ['waterproof shower curtain', 'fabric shower curtain', 'plastic shower liner', 'shower curtain liner'],
    'soap dispenser': ['liquid soap pump', 'foaming soap dispenser', 'refillable soap pump', 'countertop soap dispenser'],
    'toothbrush holder': ['bathroom toothbrush stand', 'cup toothbrush holder', 'wall mounted toothbrush holder'],
    'toilet paper holder': ['tp roll holder', 'toilet paper roller', 'bathroom paper holder', 'recessed paper holder'],
    'towel bar': ['bathroom towel rack', 'towel rail', 'heated towel bar', 'double towel bar'],
    'bathroom mirror': ['vanity bathroom mirror', 'framed bathroom mirror', 'led backlit mirror', 'round bathroom mirror'],
    'floor mirror': ['full length floor mirror', 'leaning mirror', 'standing full body mirror', 'long floor mirror'],
    'medicine cabinet': ['bathroom medicine cabinet', 'mirrored medicine cabinet', 'recessed medicine cabinet'],
    'bathroom vanity': ['bathroom sink vanity', 'floating bathroom vanity', 'single sink vanity unit'],
    'drain cover': ['shower drain cover', 'floor drain grate', 'drain strainer', 'bathtub drain stopper'],
    'toilet brush': ['toilet bowl brush', 'silicone toilet brush', 'bathroom bowl scrubber'],
    'bathroom faucet': ['bathroom sink tap', 'vessel sink faucet', 'widespread bathroom faucet', 'single hole faucet'],
    'kitchen faucet': ['pull down kitchen faucet', 'kitchen mixer tap', 'pull out faucet', 'bridge kitchen faucet'],
    'umbrella stand': ['umbrella holder', 'entryway umbrella holder', 'cane holder stand'],
    // ── Home Organization ─────────────────────────────────────────────────────
    'laundry basket': ['clothes hamper', 'laundry hamper', 'collapsible laundry basket', 'canvas laundry basket'],
    'ironing board': ['freestanding ironing board', 'tabletop ironing board', 'wall mount iron board'],
    'hangers': ['clothes hanger', 'shirt hanger', 'coat hanger', 'plastic clothes hangers', 'suit hanger'],
    'velvet hangers': ['felt hangers', 'slim velvet clothes hangers', 'non slip flocked hangers'],
    'coat hook': ['wall coat hook', 'multi coat hook', 'entryway coat hook', 'behind door hook'],
    'wall hook': ['adhesive wall hook', 'heavy duty wall hook', 'decorative hook', 'over door hook'],
    'key holder': ['key rack', 'key organizer hook', 'key cabinet', 'key storage box', 'key hook board'],
    'mail organizer': ['letter organizer', 'wall mail holder', 'desktop mail sorter', 'paper mail sorter'],
    'laundry bag': ['mesh laundry bag', 'delicate wash bag', 'lingerie laundry bag', 'travel laundry bag'],
    'shoe horn': ['long handle shoe horn', 'flexible shoe horn', 'folding shoe horn', 'telescoping shoe horn'],
    'lint brush': ['fabric clothes brush', 'pet hair removal brush', 'velvet lint brush', 'lint remover brush'],
    // ── Cleaning Products ─────────────────────────────────────────────────────
    'carpet cleaner': ['carpet shampoo', 'upholstery carpet cleaner', 'stain remover carpet', 'carpet spray foam'],
    'floor cleaner': ['hardwood floor cleaner', 'laminate floor cleaner', 'tile floor cleaner', 'floor wash liquid'],
    'oven cleaner': ['oven degreaser', 'grill cleaner', 'foam oven cleaner', 'heavy duty oven spray'],
    'drain cleaner': ['drain unclogger gel', 'drain clearing liquid', 'clog remover', 'drain opener', 'pipe cleaner gel'],
    'tile cleaner': ['grout cleaner', 'tile and grout spray', 'shower tile cleaner', 'bathroom tile spray'],
    // ── Personal Care & Beauty ────────────────────────────────────────────────
    'bath bomb': ['fizzy bath bomb', 'bath fizzer', 'aromatherapy bath bomb', 'luxury bath bomb'],
    'bath salts': ['epsom bath salts', 'himalayan bath salts', 'dead sea bath salts', 'muscle soak salts'],
    'body scrub': ['sugar body scrub', 'coffee body scrub', 'exfoliating scrub', 'salt body scrub'],
    'facial roller': ['rose quartz roller', 'jade face roller', 'anti aging facial roller', 'face massage roller'],
    'gua sha': ['facial gua sha stone', 'rose quartz gua sha', 'jade gua sha tool', 'gua sha face tool'],
    'derma roller': ['microneedle derma roller', 'skin micro roller', 'collagen derma roller', 'micro needling tool'],
    'eye patches': ['under eye gel patch', 'gold collagen eye patch', 'hydrogel eye pad', 'depuff eye patch'],
    'sheet mask': ['korean face sheet mask', 'hydrating sheet mask', 'collagen sheet face mask'],
    'mud mask': ['clay mud face mask', 'detox mud mask', 'pore cleansing mud mask', 'charcoal face mask'],
    'lip scrub': ['sugar lip exfoliator', 'exfoliating lip treatment', 'mint lip scrub', 'honey lip scrub'],
    'cuticle oil': ['nail cuticle treatment oil', 'cuticle cream oil', 'nail oil serum', 'nail hydrating oil'],
    'nail buffer': ['nail shine buffer block', 'four way nail buffer', 'buffing nail block', 'nail polisher block'],
    'nail clipper': ['fingernail clipper', 'toenail clipper', 'precision nail cutter', 'nail scissors clipper'],
    'nail drill': ['electric nail file drill', 'nail sanding machine', 'gel nail removal drill', 'nail art drill'],
    'soap mold': ['silicone soap mold', 'loaf soap mold', 'melt pour soap mold', 'craft soap mold'],
    'hair net': ['invisible hair net', 'ballet bun net', 'food service hair net', 'fine mesh hair net'],
    'hair turban': ['microfiber hair drying towel', 'hair wrap turban', 'twist drying towel hair'],
    'hair bonnet': ['satin sleeping bonnet', 'silk sleep bonnet', 'hair protection bonnet'],
    'satin pillowcase': ['silk satin pillowcase', 'smooth satin pillowcase', 'anti frizz satin case'],
    'silk pillowcase': ['mulberry silk pillowcase', 'pure silk pillowcase', 'luxury silk bed pillow'],
    'eye mask': ['silk sleep eye mask', 'blackout sleep mask', 'cooling eye mask', 'satin sleeping mask'],
    'earplugs': ['foam sleeping earplugs', 'reusable ear plugs', 'noise blocking earplugs', 'concert earplugs'],
    // ── Aromatherapy & Wellness ───────────────────────────────────────────────
    'essential oil diffuser': ['ultrasonic aroma diffuser', 'aromatherapy diffuser', 'cool mist diffuser'],
    'incense sticks': ['incense cone', 'sandalwood incense sticks', 'palo santo sticks', 'scented incense'],
    'wax melt': ['scented wax melt', 'wax cubes', 'fragrance wax tart', 'soy wax melt'],
    'reed diffuser': ['room reed diffuser', 'bamboo reed diffuser', 'fragrance diffuser sticks'],
    'meditation cushion': ['zafu meditation cushion', 'yoga meditation pillow', 'floor cushion bolster'],
    // ── Photo & Decor ─────────────────────────────────────────────────────────
    'photo album': ['scrapbook photo album', 'slip in photo album', 'brag book', 'wedding photo album'],
    'digital photo frame': ['wifi digital photo frame', 'smart picture frame', 'cloud photo frame'],
    'alarm clock': ['digital alarm clock', 'dual alarm clock', 'sunrise alarm clock', 'smart alarm clock'],
    // ── Crafts & Hobbies ──────────────────────────────────────────────────────
    'embroidery hoop': ['embroidery frame', 'cross stitch hoop', 'needlework embroidery hoop'],
    'crochet hook': ['crochet needle', 'ergonomic crochet hook', 'aluminum crochet hook set'],
    'card game': ['collectible card game', 'party card game', 'strategy card game', 'uno style game'],
    'paint by numbers': ['paint by number kit', 'diy canvas paint kit', 'numbered paint set'],
    'diamond painting': ['5d diamond painting', 'diamond art kit', 'diamond dotz', 'diamond mosaic art'],
    'resin mold': ['silicone resin mold', 'epoxy casting mold', 'uv resin mold', 'craft silicone mold'],
    // ── Water & Hydration ─────────────────────────────────────────────────────
    'water bottle': ['reusable water bottle', 'stainless water bottle', 'bpa free bottle', 'sports water bottle'],
    'insulated bottle': ['vacuum insulated bottle', 'double wall insulated bottle', 'stainless insulated bottle'],
    'thermos': ['thermos flask', 'hot cold thermos', 'vacuum insulated thermos', 'stainless steel thermos'],
    'hydration pack': ['water backpack', 'hydration backpack', 'running hydration vest', 'camelbak type pack'],
    'water pitcher': ['filter water pitcher', 'brita type pitcher', 'alkaline water pitcher', 'glass water pitcher'],
    // ── Party & Events ────────────────────────────────────────────────────────
    'balloon': ['latex balloon', 'foil balloon', 'helium balloon', 'mylar balloon', 'giant balloon', 'balloon set'],
    'party hat': ['birthday party hat', 'cone party hat', 'metallic party hat', 'birthday crown hat'],
    'gift box': ['gift packaging box', 'decorative gift box', 'rigid gift box', 'magnetic gift box'],
    'christmas tree': ['artificial christmas tree', 'pre lit christmas tree', 'flocked xmas tree', 'slim christmas tree'],
    // ── Home Fixtures misc ────────────────────────────────────────────────────
    'whiteboard': ['dry erase whiteboard', 'magnetic whiteboard', 'glass whiteboard', 'portable whiteboard'],
    'humidifier filter': ['evaporator wick filter', 'replacement humidifier filter', 'universal filter humidifier'],
    'water softener': ['whole house water softener', 'salt free softener', 'portable water softener'],
    // ── Food & Beverages (expanded) ───────────────────────────────────────────
    'tomato paste': ['tomato concentrate', 'double concentrate tomato', 'crushed tomato paste', 'canned tomato paste'],
    'peanut butter': ['creamy peanut butter', 'crunchy peanut butter', 'natural peanut butter', 'pb spread'],
    'almond butter': ['natural almond butter', 'roasted almond butter', 'raw almond butter', 'almond spread'],
    'tahini': ['sesame paste', 'tahini paste', 'ground sesame', 'sesame butter', 'hulled tahini'],
    'energy drink': ['energy beverage', 'caffeinated drink', 'red bull type', 'monster type drink', 'energy shot'],
    'sports drink': ['electrolyte drink', 'hydration drink', 'gatorade type', 'isotonic drink', 'electrolyte sports'],
    'kombucha': ['fermented tea', 'probiotic kombucha', 'raw kombucha', 'jun kombucha', 'water kefir'],
    'sparkling water': ['carbonated water', 'seltzer water', 'club soda', 'fizzy water', 'mineral sparkling water'],
    'coconut water': ['natural coconut water', 'raw coconut water', 'tender coconut water', 'packaged coconut water'],
    'frozen berries': ['frozen blueberries', 'frozen strawberries', 'frozen mixed berries', 'frozen raspberries'],
    'dried mango': ['dried fruit mango', 'dehydrated mango', 'mango strips dried', 'sweet dried mango'],
    'beef jerky': ['jerky beef', 'dried beef snack', 'meat jerky', 'peppered beef jerky', 'teriyaki jerky'],
    'seaweed snack': ['roasted seaweed', 'nori snack', 'seaweed chips', 'dried seaweed snack', 'seasoned seaweed'],
    'rice cracker': ['senbei', 'puffed rice cracker', 'rice cake snack', 'japanese rice cracker', 'crispy rice snack'],
    'oat milk': ['oat milk drink', 'barista oat milk', 'organic oat milk', 'oat beverage', 'oat creamer'],
    'almond milk': ['unsweetened almond milk', 'vanilla almond milk', 'almond beverage', 'barista almond milk'],
    'soy milk': ['soy beverage', 'unsweetened soy milk', 'fortified soy milk', 'organic soy drink'],
    'condensed milk': ['sweetened condensed milk', 'coconut condensed milk', 'canned condensed milk'],
    'evaporated milk': ['canned evaporated milk', 'unsweetened evaporated', 'fat free evaporated milk'],
    'cream cheese': ['full fat cream cheese', 'whipped cream cheese', 'spreadable cream cheese', 'block cream cheese'],
    'cottage cheese': ['low fat cottage cheese', 'small curd cottage', 'large curd cottage cheese'],
    'sour cream': ['full fat sour cream', 'light sour cream', 'dairy sour cream', 'mexican crema'],
    'heavy cream': ['heavy whipping cream', 'double cream', 'thickened cream', 'fresh whipping cream'],
    'baby formula': ['infant formula', 'toddler formula', 'newborn formula', 'hypoallergenic formula', 'soy formula'],
    'canned soup': ['ready to serve soup', 'condensed soup', 'chicken noodle soup can', 'tomato soup can'],
    'chicken broth': ['chicken stock', 'bone broth chicken', 'low sodium broth', 'organic chicken broth'],
    'vegetable broth': ['vegetable stock', 'veggie broth', 'low sodium vegetable broth', 'organic veggie stock'],
    'miso paste': ['white miso', 'red miso', 'shiro miso', 'soybean miso paste', 'fermented miso'],
    'energy bar': ['protein energy bar', 'granola energy bar', 'clif bar type', 'larabar type', 'nut bar'],
    'meal replacement': ['meal replacement shake', 'slim fast type', 'huel type', 'soylent type', 'complete nutrition shake'],
    // ── Electronics (expanded) ────────────────────────────────────────────────
    'drawing tablet': ['graphics drawing tablet', 'pen tablet', 'wacom type tablet', 'digital drawing pad'],
    'stylus pen': ['active stylus', 'capacitive stylus', 'apple pencil type', 'touch stylus', 'digital pen'],
    'smart speaker': ['voice assistant speaker', 'alexa speaker', 'google home type', 'wifi smart speaker'],
    'surge protector': ['power surge protector', 'surge suppressor', 'spike guard', 'surge strip', 'usb surge protector'],
    'power strip': ['multi outlet strip', 'extension power strip', 'surge protected strip', 'power board'],
    'extension cord': ['extension lead', 'power extension cable', 'heavy duty extension cord', 'outdoor extension cord'],
    'cable tie': ['zip tie cable', 'velcro cable tie', 'reusable cable tie', 'cable management tie'],
    'thermal printer': ['direct thermal printer', 'label thermal printer', 'portable thermal printer', 'bluetooth thermal printer'],
    'flatbed scanner': ['document flatbed scanner', 'photo scanner', 'a4 flatbed scanner', 'film scanner'],
    'cpu cooler': ['processor cooler', 'cpu fan cooler', 'liquid cpu cooler', 'aio cooler', 'tower cooler'],
    'pc case': ['atx case', 'mid tower case', 'mini itx case', 'computer tower case', 'gaming pc case'],
    // ── Personal Care (expanded) ──────────────────────────────────────────────
    'electric razor': ['electric shaver razor', 'foil razor electric', 'rotary razor', 'wet dry razor'],
    'shaving foam': ['shaving cream foam', 'aerosol shave foam', 'sensitive shaving foam', 'moisturizing shave foam'],
    'aftershave lotion': ['aftershave balm', 'post shave lotion', 'aftershave splash', 'cooling aftershave'],
    'deodorant stick': ['stick deodorant', 'solid deodorant', 'clinical deodorant', 'natural deodorant stick'],
    'deodorant spray': ['spray deodorant', 'body spray deodorant', 'aerosol deodorant', 'invisible spray deodorant'],
    'sunscreen lotion': ['sun cream', 'sun block', 'spf lotion', 'sunscreen spf 50', 'mineral sunscreen'],
    'tanning lotion': ['self tanner', 'fake tan', 'sunless tanner', 'gradual tanning lotion', 'tan extender'],
    'face wash': ['facial cleanser', 'foaming face wash', 'gel cleanser', 'micellar face wash', 'gentle face wash'],
    'micellar water': ['micellar cleansing water', 'makeup remover water', 'no rinse cleanser', 'cleansing micellar'],
    'hair oil': ['argan hair oil', 'moroccan oil', 'coconut hair oil', 'jojoba hair oil', 'camellia hair oil'],
    'heat protectant': ['heat protectant spray', 'thermal protection', 'hair shield spray', 'blow dry protectant'],
    'beard oil': ['beard conditioning oil', 'moisturizing beard oil', 'jojoba beard oil', 'vitamin e beard oil'],
    'beard balm': ['beard wax', 'beard styling balm', 'beard conditioner balm', 'beard butter'],
    'foot cream': ['cracked heel cream', 'foot lotion', 'heel balm', 'intensive foot cream', 'shea foot cream'],
    'hand lotion': ['hand cream lotion', 'dry hand lotion', 'intensive hand lotion', 'moisturizing hand lotion'],
    'body butter': ['shea body butter', 'cocoa body butter', 'thick body moisturizer', 'whipped body butter'],
    'contact lens solution': ['saline solution', 'multipurpose lens solution', 'lens cleaning solution', 'renu type'],
    // ── Garden (expanded) ─────────────────────────────────────────────────────
    'compost bin': ['garden compost bin', 'tumbling composter', 'worm composter', 'kitchen composter', 'compost tumbler'],
    'rain barrel': ['water butt', 'rainwater collector', 'rain water tank', 'garden rain collector'],
    'raised bed': ['raised garden bed', 'elevated planter bed', 'raised planting bed', 'cedar raised bed'],
    'barbecue grill': ['gas bbq grill', 'charcoal bbq', 'portable grill', 'propane grill', 'kamado grill'],
    'grill brush': ['bbq brush', 'grill cleaning brush', 'grill scraper brush', 'stainless grill brush'],
    'patio umbrella': ['garden umbrella', 'outdoor parasol', 'cantilever umbrella', 'offset patio umbrella'],
    'outdoor cushion': ['patio cushion', 'garden seat cushion', 'chair cushion outdoor', 'weather resistant cushion'],
    'leaf blower': ['garden leaf blower', 'cordless leaf blower', 'backpack leaf blower', 'electric leaf blower'],
    'hedge trimmer': ['electric hedge trimmer', 'cordless hedge cutter', 'garden hedge shears', 'topiary trimmer'],
    'garden kneeler': ['garden knee pad', 'kneeling bench', 'foam knee pad garden', 'garden knee cushion'],
    'garden netting': ['plant netting', 'bird netting', 'deer netting', 'crop protection net', 'garden mesh'],
    // ── Tools & Hardware (expanded) ───────────────────────────────────────────
    'wire stripper': ['cable stripper', 'wire stripping tool', 'self adjusting stripper', 'electrician stripper'],
    'voltage tester': ['electrical tester tool', 'non contact tester', 'current tester', 'circuit tester'],
    'laser level': ['self leveling laser', 'cross line laser level', 'red beam laser level', 'green laser level'],
    'putty knife': ['scraper blade', 'drywall knife', 'filler knife', 'flexible putty knife', 'stiff scraper'],
    'caulking gun': ['caulk gun', 'silicone gun', 'sausage gun', 'manual caulk gun', 'drip free caulk gun'],
    'tile cutter': ['manual tile cutter', 'tile saw', 'wet tile saw', 'angle grinder tile', 'porcelain cutter'],
    'drywall anchor': ['wall plug', 'toggle bolt', 'plasterboard anchor', 'hollow wall anchor', 'molly bolt'],
    'wood chisel': ['firmer chisel', 'mortise chisel', 'bench chisel', 'bevel edge chisel', 'carving chisel'],
    'hand plane': ['block plane', 'smoothing plane', 'jack plane', 'bench plane', 'shoulder plane'],
    'hacksaw': ['metal hacksaw', 'junior hacksaw', 'mini hacksaw', 'hack saw blade', 'bow saw metal'],
    'file set': ['metal file set', 'hand file', 'needle file set', 'flat file', 'round file'],
    'chalk line': ['snap line', 'chalk reel', 'marking chalk line', 'chalk snap line', 'blue chalk line'],
    'mortar and pestle': ['granite mortar pestle', 'ceramic mortar', 'stone mortar', 'grinding mortar'],
    'coffee grinder': ['burr coffee grinder', 'blade grinder coffee', 'manual coffee grinder', 'conical burr grinder'],
    'spice grinder': ['electric spice grinder', 'manual spice mill', 'pepper grinder', 'herb grinder'],
    // ── Safety & Security ─────────────────────────────────────────────────────
    'smoke alarm': ['smoke detector alarm', 'fire smoke alarm', 'photoelectric alarm', 'combination alarm'],
    'carbon monoxide alarm': ['co alarm', 'carbon monoxide detector', 'co detector', 'co gas alarm'],
    'home safe': ['fireproof safe', 'floor safe', 'wall safe', 'digital safe', 'steel home safe'],
    'security light': ['motion sensor floodlight', 'outdoor security light', 'solar security light', 'led floodlight'],
    'reflective tape': ['safety reflective tape', 'high vis tape', 'reflective sticker tape', 'warning reflective'],
    'first aid bag': ['medical bag', 'emergency kit bag', 'trauma bag', 'first responder bag', 'paramedic bag'],
    // ── Office Supplies (expanded) ────────────────────────────────────────────
    'filing cabinet': ['metal filing cabinet', 'lateral file cabinet', 'two drawer cabinet', 'pedestal cabinet'],
    'flip chart': ['flip chart pad', 'easel paper pad', 'presentation paper pad', 'meeting flip chart'],
    'paper ream': ['copy paper ream', 'a4 paper ream', 'printer paper ream', 'white paper ream', '500 sheet ream'],
    'shipping envelope': ['bubble mailer', 'padded envelope', 'poly mailer', 'jiffy envelope', 'kraft envelope'],
    'shipping tape': ['packing tape', 'brown packing tape', 'clear packing tape', 'box sealing tape'],
    'address label': ['shipping label', 'return label', 'self adhesive label', 'avery label'],
    'stamp pad': ['ink pad', 'rubber stamp pad', 'felt stamp pad', 'archival ink pad', 'reinker pad'],
    'business card holder': ['card case', 'name card holder', 'desk card holder', 'metal card case'],
    // ── Baby & Kids (expanded) ────────────────────────────────────────────────
    'baby gym': ['activity gym', 'play gym mat', 'infant activity gym', 'tummy time gym', 'baby play arch'],
    'play tent': ['kids play tent', 'teepee tent kids', 'pop up play tent', 'indoor tent kids', 'princess tent'],
    'sandbox': ['sand pit', 'kids sandbox', 'backyard sandbox', 'covered sandbox', 'plastic sandbox'],
    'ride on toy': ['kids ride on', 'toddler ride on', 'power wheels type', 'push car toy', 'balance car toy'],
    'kids art easel': ['childrens easel', 'double sided easel', 'magnetic art easel', 'chalkboard easel kids'],
    'crayons': ['wax crayons', 'jumbo crayons', 'twist crayons', 'washable crayons', 'colored crayons set'],
    'washable markers': ['kids washable markers', 'washable felt tip', 'broad tip markers kids', 'crayola type marker'],
    'slime kit': ['slime making kit', 'diy slime set', 'fluffy slime', 'glitter slime kit', 'unicorn slime'],
    'bath toy': ['rubber duck', 'bath squirt toy', 'floating bath toy', 'wind up bath toy', 'bath set toy'],
    // ── Accessories (expanded) ────────────────────────────────────────────────
    'tie clip': ['tie bar', 'necktie clip', 'tie pin', 'silver tie clip', 'slim tie bar'],
    'bow tie': ['pre tied bow tie', 'self tie bow tie', 'silk bow tie', 'adjustable bow tie'],
    'suspenders': ['braces suspenders', 'clip on suspenders', 'leather suspenders', 'adjustable suspenders'],
    'arm warmer': ['fingerless gloves', 'leg warmer', 'thermal arm sleeve', 'heated sleeve'],
    'ski gloves': ['snowboard gloves', 'waterproof ski gloves', 'heated ski gloves', 'insulated snow gloves'],
    'rain boots': ['rubber boots', 'wellies', 'wellington boots', 'waterproof boots', 'gum boots'],
    'work boots': ['steel toe boots', 'safety boots', 'composite toe boots', 'leather work boots'],
    'chelsea boots': ['ankle chelsea boots', 'leather chelsea boots', 'slip on chelsea boots'],
    'espadrilles': ['espadrille sandals', 'canvas espadrilles', 'wedge espadrilles', 'jute espadrilles'],
    'loafers': ['slip on loafers', 'penny loafer', 'leather loafer', 'driving loafer', 'moccasin loafer'],
    // ── Sports (expanded) ─────────────────────────────────────────────────────
    'kayak paddle': ['canoe paddle', 'kayaking paddle', 'carbon paddle', 'lightweight paddle', 'split paddle'],
    'climbing harness': ['rock climbing harness', 'sport harness', 'full body harness', 'belay harness'],
    'tennis ball': ['pressurized tennis ball', 'practice tennis ball', 'foam tennis ball', 'bulk tennis balls'],
    'badminton set': ['badminton racket set', 'shuttlecock set', 'badminton net set', 'outdoor badminton'],
    'trampoline': ['garden trampoline', 'backyard trampoline', 'rectangular trampoline', 'trampoline with net'],
    'ankle weight': ['wrist weight', 'weighted ankle strap', 'adjustable ankle weights', 'strap on weights'],
    'batting glove': ['baseball batting glove', 'softball gloves', 'grip batting glove', 'leather batting glove'],
    // ── Vehicles & Bikes ──────────────────────────────────────────────────────
    'motorcycle helmet': ['full face helmet', 'half face helmet', 'motorbike helmet', 'dirt bike helmet'],
    'motorcycle gloves': ['riding gloves', 'motorbike gloves', 'leather motorcycle gloves', 'summer riding gloves'],
    'bicycle lock': ['bike lock', 'chain bike lock', 'u lock bike', 'folding bike lock', 'cable bike lock'],
    'bicycle bell': ['bike bell', 'cycle bell', 'handlebar bell', 'mountain bike bell'],
    'bicycle basket': ['front bike basket', 'handlebar basket', 'rear bike basket', 'wicker bike basket'],
    'electric scooter': ['e scooter', 'adult electric scooter', 'folding electric scooter', 'kick scooter electric'],
    'hoverboard': ['self balancing board', 'balance board hoverboard', 'electric hoverboard', 'segway type'],
    // ── Kitchen Tools (expanded) ──────────────────────────────────────────────
    'mandoline slicer': ['adjustable mandoline', 'vegetable mandoline', 'japanese mandoline', 'safety mandoline'],
    'vegetable spiralizer': ['spiralizer zucchini', 'spiral slicer', 'veggie slicer noodle', 'vegetable spiraler'],
    'cheese grater': ['box grater', 'flat grater', 'rotary grater', 'parmesan grater', 'microplane grater cheese'],
    'slotted spoon': ['draining spoon', 'skimmer spoon', 'slotted serving spoon', 'spider strainer spoon'],
    'meat thermometer': ['instant read thermometer', 'wireless thermometer', 'probe thermometer', 'bbq thermometer'],
    'kitchen torch': ['culinary torch', 'brulee torch', 'blow torch kitchen', 'creme brulee torch'],
    'sushi mat': ['bamboo sushi mat', 'rolling mat', 'makisu sushi mat', 'bamboo rolling mat'],
    'dumpling press': ['dumpling maker', 'empanada press', 'gyoza maker', 'pierogi maker', 'ravioli stamp'],
    'tortilla press': ['cast iron tortilla press', 'tortilla maker press', 'corn tortilla press'],
    'pasta maker': ['pasta machine', 'manual pasta maker', 'pasta roller', 'lasagna maker', 'pasta rolling machine'],
    'waffle maker': ['waffle iron', 'belgian waffle maker', 'mini waffle maker', 'flip waffle iron'],
    'crepe maker': ['crepe pan', 'electric crepe maker', 'non stick crepe pan', 'french crepe maker'],
    'bread maker': ['bread machine', 'automatic bread maker', 'programmable bread machine', 'home bread maker'],
    // ── Home Decor & Misc ─────────────────────────────────────────────────────
    'picture light': ['art light', 'gallery light', 'painting light', 'led picture light', 'canvas light'],
    'bookend': ['metal bookend', 'decorative bookend', 'heavy duty bookend', 'marble bookend'],
    'clock hands': ['replacement clock hands', 'clock mechanism', 'clock movement', 'quartz clock movement'],
    'door stopper': ['door wedge', 'door stop', 'heavy door stopper', 'magnetic door stop'],
    'draft stopper': ['door draft stopper', 'window draft guard', 'door seal strip', 'draft excluder'],
    'coat stand': ['hat and coat stand', 'freestanding coat rack', 'entry coat stand', 'bamboo coat stand'],
    'magazine rack': ['periodical rack', 'magazine holder', 'newspaper rack', 'wall magazine rack'],
    'laundry sorter': ['three bin sorter', 'laundry cart', 'rolling laundry sorter', 'hamper sorter'],
    'dish rack': ['dish drying rack', 'counter dish rack', 'over sink rack', 'collapsible dish rack'],
    'kitchen mat': ['anti fatigue mat', 'non slip kitchen mat', 'comfort mat kitchen', 'cushioned kitchen mat'],
    'shelf bracket': ['metal shelf bracket', 'floating shelf bracket', 'l bracket shelf', 'wall bracket'],
    'picture hook': ['nail hook picture', 'keyhole hook', 'gallery hook', 'heavy duty picture hook'],
    'tension rod': ['spring tension rod', 'adjustable tension rod', 'shower tension rod', 'curtain spring rod'],
    'cable raceway': ['cord cover raceway', 'wire raceway', 'cable management channel', 'floor cable cover'],
    'wire basket': ['metal wire basket', 'grid wire basket', 'storage wire basket', 'hanging wire basket'],
    'pegboard': ['tool pegboard', 'garage pegboard', 'craft pegboard', 'slatwall panel', 'hookboard'],
    'plant hanger': ['macrame plant hanger', 'hanging planter rope', 'plant holder hanger', 'wall plant hanger'],
    // ── More not-yet-covered ──────────────────────────────────────────────────
    'air mattress': ['inflatable mattress', 'camping air bed', 'blow up mattress', 'self inflating mat', 'guest air bed'],
    'mattress topper': ['memory foam topper', 'latex topper', 'featherbed topper', 'cooling topper', 'pad topper'],
    'mattress protector': ['waterproof mattress cover', 'mattress encasement', 'fitted mattress protector'],
    'pillow protector': ['pillow encasement', 'waterproof pillow cover', 'allergy pillow cover'],
    'foam wedge': ['bed wedge pillow', 'reading wedge', 'leg elevation wedge', 'foam positioning wedge'],
    'back pillow': ['lumbar pillow', 'back support pillow', 'chair back cushion', 'seat back pillow'],
    'floor pillow': ['floor cushion', 'giant floor pillow', 'meditation floor pillow', 'seating cushion'],
    'garden fork': ['digging fork', 'border fork', 'spading fork', 'pitchfork', 'hand fork'],
    'soil test kit': ['ph soil tester', 'garden test kit', 'digital soil meter', 'nutrient test soil'],
    'plant mister': ['spray bottle plant', 'fine mist sprayer', 'plant water mister', 'hand pump mister'],
    'self watering planter': ['self watering pot', 'reservoir planter', 'wicking planter', 'indoor self water pot'],
    'grow bag': ['fabric grow bag', 'planting grow bag', 'tomato grow bag', 'potato grow bag'],
    'greenhouse': ['mini greenhouse', 'walk in greenhouse', 'cold frame greenhouse', 'portable greenhouse'],
    'row cover': ['frost cloth', 'garden fleece', 'plant cover frost', 'floating row cover'],
    'trellis': ['garden trellis', 'plant trellis', 'metal trellis', 'expandable trellis', 'vine trellis'],
    // ── Musical Instruments (expanded) ───────────────────────────────────────────
    'banjo': ['5 string banjo', 'bluegrass banjo', 'tenor banjo', 'open back banjo', 'resonator banjo'],
    'djembe': ['hand drum djembe', 'african djembe', 'rope tuned djembe', 'beginner djembe'],
    'bongo drum': ['bongo drums', 'percussion bongo', 'latin bongo set', 'wooden bongo'],
    'clarinet': ['bb clarinet', 'bass clarinet', 'student clarinet', 'beginner clarinet', 'wooden clarinet'],
    'oboe': ['student oboe', 'professional oboe', 'beginner oboe', 'plastic oboe', 'wood oboe'],
    'recorder': ['soprano recorder', 'alto recorder', 'plastic recorder', 'baroque recorder', 'descant recorder'],
    'metronome': ['digital metronome', 'mechanical metronome', 'clip on metronome', 'quartz metronome', 'pendulum metronome'],
    'tuning fork': ['a440 tuning fork', 'pitch fork tuning', 'concert tuning fork', 'steel tuning fork'],
    'mandolin': ['acoustic mandolin', 'electric mandolin', 'f style mandolin', 'a style mandolin', 'bluegrass mandolin'],
    'music sheet': ['sheet music', 'music notation paper', 'blank staff paper', 'manuscript paper', 'music score'],
    // ── Photography/Video (expanded) ──────────────────────────────────────────────
    'camera lens': ['dslr lens', 'mirrorless lens', 'telephoto lens', 'wide angle lens', 'prime lens'],
    'ring light': ['selfie ring light', 'led ring light', 'beauty ring light', 'clip on ring light', 'ring lamp'],
    'studio backdrop': ['photography backdrop', 'photo background', 'vinyl backdrop', 'muslin backdrop', 'pop up backdrop'],
    'green screen': ['chroma key backdrop', 'green screen backdrop', 'collapsible green screen', 'portable green screen'],
    'camera strap': ['neck camera strap', 'wrist camera strap', 'shoulder strap camera', 'quick release strap'],
    'lens cap': ['camera lens cap', 'front lens cap', 'rear lens cap', 'cap keeper lens', 'pinch cap lens'],
    'polarizing filter': ['circular polarizer', 'cpl filter', 'polarizer lens filter', 'photography polarizer'],
    'led video light': ['video panel light', 'led fill light', 'bi color led panel', 'photography led light'],
    // ── Gaming (expanded) ─────────────────────────────────────────────────────────
    'gaming monitor': ['144hz monitor', 'curved gaming monitor', '4k gaming monitor', 'freesync monitor', 'gsync monitor'],
    'gaming desk': ['l shaped gaming desk', 'rgb gaming desk', 'racing style desk', 'gaming computer desk'],
    'game controller': ['wireless controller', 'gamepad controller', 'usb game controller', 'pc controller'],
    'joystick': ['flight joystick', 'pc joystick', 'arcade joystick', 'hotas joystick', 'usb joystick'],
    'steering wheel controller': ['racing wheel', 'gaming steering wheel', 'force feedback wheel', 'logitech racing wheel type'],
    // ── Smart Home (expanded) ─────────────────────────────────────────────────────
    'smart lock': ['keyless door lock', 'wifi smart lock', 'bluetooth door lock', 'digital door lock', 'fingerprint lock'],
    'smart switch': ['wifi light switch', 'smart wall switch', 'touch smart switch', 'no neutral switch'],
    'zigbee hub': ['smart home hub zigbee', 'zigbee coordinator', 'matter hub', 'zwave hub', 'universal hub'],
    // ── Crafts & Hobbies ──────────────────────────────────────────────────────────
    'needle felt': ['needle felting kit', 'wool felt needle', 'felting needle set', 'starter felting kit'],
    'cross stitch kit': ['cross stitch set', 'counted cross stitch', 'beginner cross stitch', 'embroidery cross stitch'],
    'macrame kit': ['macrame starter kit', 'macrame cord kit', 'wall hanging kit', 'boho macrame kit'],
    'candle making kit': ['candle pour kit', 'soy wax kit', 'candle making supplies', 'diy candle set'],
    'soap making kit': ['cold process soap kit', 'melt and pour kit', 'diy soap set', 'glycerin soap kit'],
    'jewelry making kit': ['bead kit jewelry', 'wire wrapping kit', 'jewelry findings set', 'pendant making kit'],
    'loom': ['weaving loom', 'peg loom', 'lap loom', 'circular loom', 'rigid heddle loom'],
    'pottery clay': ['air dry clay', 'kiln fire clay', 'self hardening clay', 'polymer clay modeling'],
    'modeling clay': ['sculpting clay', 'non drying clay', 'plasticine', 'oil based clay', 'chavant clay'],
    'watercolor paint': ['watercolor set', 'watercolour paints', 'tube watercolor', 'pan watercolor', 'artist watercolor'],
    'oil paint': ['artist oil paint', 'oil painting set', 'oil colour tubes', 'professional oil paint'],
    'paint palette': ['mixing palette', 'artist palette', 'stay wet palette', 'disposable palette', 'glass palette'],
    'easel': ['tabletop easel', 'studio easel', 'tripod easel', 'a frame easel', 'french easel'],
    'sketch pad': ['drawing pad', 'sketch book', 'artist sketchpad', 'a4 sketch pad', 'cartridge paper pad'],
    'chalk pastel': ['soft pastels', 'oil pastels set', 'chalk sticks art', 'pastel drawing set'],
    // ── Health & Wellness (expanded) ──────────────────────────────────────────────
    'massage gun': ['percussion massager', 'deep tissue massager', 'muscle gun massager', 'fascia gun'],
    'foot massager': ['electric foot spa', 'shiatsu foot massager', 'foot bath massager', 'plantar massager'],
    'neck massager': ['shiatsu neck massager', 'electric neck pillow', 'shoulder neck massager', 'cervical massager'],
    'posture corrector': ['back posture corrector', 'posture brace support', 'clavicle brace', 'shoulder posture'],
    'hot water bottle': ['rubber hot water bottle', 'heat therapy bottle', 'microwave heat bag', 'gel heat pack'],
    'cold pack': ['ice pack gel', 'reusable cold pack', 'flexible ice pack', 'cold therapy pack'],
    'compression sleeve': ['knee compression sleeve', 'arm compression sleeve', 'calf sleeve compression', 'elbow sleeve'],
    'cervical pillow': ['neck support pillow', 'orthopedic cervical pillow', 'contour neck pillow'],
    'blood glucose monitor': ['glucometer', 'blood sugar monitor', 'glucose meter', 'diabetes monitor'],
    // ── Supplements (expanded) ────────────────────────────────────────────────────
    'whey protein': ['whey protein powder', 'isolate protein', 'concentrate whey', 'chocolate whey protein'],
    'creatine': ['creatine monohydrate', 'creatine powder', 'micronized creatine', 'creatine supplement'],
    'bcaa': ['branched chain amino acid', 'amino acid supplement', 'bcaa powder', 'bcaa capsules'],
    'multivitamin': ['multivitamin tablet', 'daily vitamin', 'mens multivitamin', 'womens multivitamin', 'complete vitamin'],
    'vitamin c': ['vitamin c supplement', 'ascorbic acid supplement', 'chewable vitamin c', 'liposomal vitamin c'],
    'melatonin': ['melatonin supplement', 'sleep aid melatonin', 'melatonin gummies', 'natural sleep supplement'],
    'magnesium': ['magnesium supplement', 'magnesium glycinate', 'magnesium citrate', 'magnesium oxide tablets'],
    'ashwagandha': ['ashwagandha supplement', 'ashwagandha root extract', 'ksm 66 ashwagandha', 'withania somnifera'],
    'elderberry': ['elderberry supplement', 'elderberry syrup', 'black elderberry gummies', 'sambucus elderberry'],
    'omega 3': ['fish oil omega 3', 'omega 3 capsules', 'flaxseed omega 3', 'algal omega 3 supplement'],
    // ── Electronics Accessories (expanded) ────────────────────────────────────────
    'screen protector': ['tempered glass protector', 'phone screen guard', 'anti scratch film', 'privacy screen protector'],
    'tablet stand': ['adjustable tablet holder', 'ipad stand', 'tablet desk stand', 'foldable tablet stand'],
    'monitor riser': ['desk monitor stand riser', 'screen riser', 'monitor lift', 'ergonomic monitor riser'],
    'desk pad': ['large mouse pad', 'desk mat', 'leather desk pad', 'gaming desk pad', 'xl desk pad'],
    'led desk lamp': ['adjustable desk lamp', 'usb desk lamp', 'touch desk lamp', 'eye care desk lamp'],
    'clip on fan': ['usb desk fan', 'mini clip fan', 'portable clip fan', 'stroller fan clip'],
    // ── Camping & Outdoor (expanded) ──────────────────────────────────────────────
    'camp stove': ['portable camp stove', 'backpacking stove', 'gas camp stove', 'butane stove camping'],
    'sleeping pad': ['foam sleeping pad', 'inflatable sleeping pad', 'ultralight pad', 'insulated sleeping mat'],
    'tarp': ['camping tarp', 'waterproof tarp', 'hammock tarp', 'rain fly tarp', 'silnylon tarp'],
    'multi tool': ['pocket multi tool', 'leatherman type', 'folding multi tool', 'stainless multi tool'],
    'fire starter': ['ferrocerium rod', 'flint fire starter', 'waterproof matches', 'magnesium fire starter'],
    'emergency whistle': ['survival whistle', 'loud emergency whistle', 'pea less whistle', 'safety whistle'],
    'dry bag': ['waterproof dry bag', 'roll top bag', 'kayak dry bag', 'outdoor dry sack'],
    'camp knife': ['fixed blade knife', 'survival knife', 'bushcraft knife', 'outdoor hunting knife'],
    // ── Pet Supplies (expanded) ───────────────────────────────────────────────────
    'cat scratcher': ['cat scratch post', 'cardboard scratcher', 'sisal scratcher', 'cat scratching pad'],
    'cat tunnel': ['collapsible cat tunnel', 'play tunnel cat', 'crinkle tunnel cat', 'interactive cat tunnel'],
    'dog crate': ['wire dog crate', 'folding dog crate', 'heavy duty dog crate', 'dog kennel crate'],
    'dog muzzle': ['basket dog muzzle', 'soft dog muzzle', 'adjustable dog muzzle', 'baskerville muzzle'],
    'hamster wheel': ['silent spinner wheel', 'hamster running wheel', 'exercise wheel hamster', 'sand wheel'],
    'guinea pig cage': ['small animal cage', 'guinea pig enclosure', 'rabbit cage hutch', 'ferret cage'],
    'aquarium heater': ['fish tank heater', 'submersible heater', 'digital aquarium heater', 'titanium heater'],
    'fish food': ['tropical fish flakes', 'fish pellets', 'betta fish food', 'goldfish food', 'freeze dried food'],
    'reptile lamp': ['uvb reptile light', 'basking bulb', 'terrarium heat lamp', 'ceramic heat emitter'],
    'pet stairs': ['dog steps pet', 'pet ramp stairs', 'foam pet stairs', 'collapsible pet stairs'],
    'dog brush': ['slicker brush dog', 'deshedding brush', 'grooming brush dog', 'pin brush pet'],
    'cat food': ['dry cat food', 'wet cat food', 'grain free cat food', 'kitten food', 'senior cat food'],
    'pet feeder': ['automatic pet feeder', 'timed pet feeder', 'gravity feeder', 'portion control feeder'],
    // ── Automotive (expanded) ─────────────────────────────────────────────────────
    'car vacuum': ['handheld car vacuum', 'cordless car vac', '12v car vacuum', 'portable car cleaner'],
    'car wax': ['paste car wax', 'spray car wax', 'liquid wax car', 'carnuba wax', 'ceramic wax'],
    'clay bar': ['detailing clay bar', 'car clay bar', 'synthetic clay bar', 'detailer clay'],
    'car phone mount': ['windshield phone holder', 'vent phone mount', 'magnetic phone mount car', 'dashboard mount'],
    'jump starter': ['portable jump starter', 'car battery booster', 'emergency jump pack', 'lithium jump starter'],
    'tire inflator': ['portable air compressor', 'digital tire pump', '12v tire inflator', 'electric pump tyre'],
    // ── Cleaning (expanded) ───────────────────────────────────────────────────────
    'microfiber cloth': ['microfibre cloth', 'cleaning microfiber', 'polishing cloth', 'detailing cloth'],
    'enzyme cleaner': ['biological cleaner', 'enzyme spray', 'pet odor enzyme cleaner', 'urine enzyme remover'],
    'grout cleaner': ['tile grout cleaner', 'grout brush cleaner', 'grout pen', 'grout whitener'],
    'descaler': ['kettle descaler', 'limescale remover', 'descaling solution', 'coffee machine descaler'],
    'washing machine cleaner': ['washer cleaner tablet', 'washing machine drum cleaner', 'machine cleaning wipe'],
    'drain snake': ['plumbing snake', 'hair catcher drain', 'drain auger', 'flexible drain rod'],
    // ── Fashion Accessories (expanded) ────────────────────────────────────────────
    'hair claw': ['claw clip', 'jaw clip hair', 'butterfly clip', 'large hair claw', 'mini claw clips'],
    'bobby pin': ['hair grip', 'kirby grip', 'hair pin set', 'invisible hair pins', 'wave pins'],
    'headband': ['elastic headband', 'wide headband', 'sports headband', 'velvet headband', 'hair hoop'],
    'bandana': ['square scarf', 'cotton bandana', 'printed bandana', 'neck kerchief', 'biker bandana'],
    'belt bag': ['waist bag', 'hip bag', 'crossbody belt bag', 'running belt bag'],
    // ── Sewing & Textiles (expanded) ─────────────────────────────────────────────
    'elastic cord': ['elastic band sewing', 'stretch cord', 'round elastic', 'flat elastic', 'woven elastic'],
    'iron on patch': ['heat transfer patch', 'embroidered iron patch', 'sew on patch', 'applique patch'],
    'seam ripper': ['stitch remover', 'unpicker tool', 'quick unpick', 'sewing ripper'],
    'bias tape': ['bias binding', 'double fold tape', 'cotton bias tape', 'quilt binding'],
    'snap fastener': ['press stud', 'metal snap button', 'plastic snap fastener', 'popper fastener'],
    // ── Food & Kitchen (expanded) ─────────────────────────────────────────────────
    'cooking spray': ['non stick spray', 'baking spray', 'olive oil spray', 'coconut oil spray'],
    'baking powder': ['baking raising agent', 'baking powder sachet', 'aluminium free baking powder'],
    'vanilla extract': ['vanilla essence', 'pure vanilla extract', 'vanilla bean paste', 'imitation vanilla'],
    'maple syrup': ['pure maple syrup', 'organic maple syrup', 'amber maple syrup', 'sugar free maple syrup'],
    'salad dressing': ['vinaigrette', 'ranch dressing', 'caesar dressing', 'italian dressing', 'balsamic dressing'],
    'nutritional yeast': ['nooch yeast', 'deactivated yeast flakes', 'vegan cheese yeast', 'fortified nutritional yeast'],
    'instant coffee': ['instant coffee granules', 'freeze dried coffee', 'soluble coffee', 'instant espresso'],
    // ── Home & Bedding (expanded) ─────────────────────────────────────────────────
    'quilt': ['patchwork quilt', 'cotton quilt', 'king quilt', 'reversible quilt', 'quilted coverlet'],
    'comforter': ['down comforter', 'duvet insert', 'all season comforter', 'alternative comforter'],
    'electric blanket': ['heated throw', 'electric bed warmer', 'underblanket heated', 'throw electric heated'],
    'bed rail': ['toddler bed rail', 'bed guard rail', 'fold down bed rail', 'safety bed rail'],
    // ── Office (expanded) ─────────────────────────────────────────────────────────
    'cork board': ['pin board', 'notice board cork', 'bulletin board', 'memo board cork'],
    'whiteboard eraser': ['dry erase eraser', 'magnetic eraser board', 'felt eraser whiteboard', 'board eraser'],
    'name badge': ['id badge holder', 'name tag badge', 'lanyard badge holder', 'conference badge'],
    // ── Sous Vide & Specialty Cooking ─────────────────────────────────────────────
    'sous vide': ['sous vide cooker', 'immersion circulator', 'precision cooker', 'water bath cooker'],
    'immersion blender': ['hand blender', 'stick blender', 'boat motor blender', 'cordless hand blender'],
    'panini press': ['sandwich press', 'panini maker', 'contact grill', 'george foreman type'],
    'ice maker': ['portable ice maker', 'countertop ice machine', 'bullet ice maker', 'nugget ice maker'],
    'air fryer basket': ['air fryer liner', 'air fryer tray', 'silicone air fryer basket', 'parchment air fryer'],
    'veggie chopper': ['food chopper', 'manual vegetable chopper', 'onion dicer chopper', 'pull string chopper'],
    // ── Water Sports & Pool ───────────────────────────────────────────────────────
    'wetsuit': ['full wetsuit', 'shorty wetsuit', 'mens wetsuit', 'womens wetsuit', 'neoprene wetsuit'],
    'swim cap': ['silicone swim cap', 'latex swim cap', 'long hair swim cap', 'competition swim cap'],
    'pool float': ['inflatable pool float', 'pool lounger float', 'swimming ring float', 'pool noodle float'],
    'inflatable pool': ['above ground pool', 'paddling pool', 'family paddling pool', 'kids splash pool'],
    'paddleboard': ['stand up paddleboard', 'inflatable sup board', 'sup paddle board', 'isup paddleboard'],
    'diving fins': ['swim fins', 'short fins', 'long blade fins', 'snorkeling fins', 'mono fin'],
    // ── Hair Care Tools (expanded) ────────────────────────────────────────────────
    'hair dryer': ['blow dryer', 'ionic hair dryer', 'travel hair dryer', 'professional hair dryer', 'diffuser dryer'],
    'curling wand': ['hair curling wand', 'wand curler', 'clip less wand', 'beach wave wand', 'tapered wand'],
    'diffuser attachment': ['hair diffuser', 'dryer diffuser', 'curl diffuser', 'afro diffuser', 'universal diffuser'],
    // ── Makeup (expanded) ─────────────────────────────────────────────────────────
    'eyeshadow palette': ['eye shadow palette', 'neutral palette', 'glitter palette', 'matte palette'],
    'lip gloss': ['clear lip gloss', 'plumping gloss', 'tinted lip gloss', 'high shine gloss', 'sticky gloss'],
    'brow gel': ['clear brow gel', 'tinted brow gel', 'eyebrow gel', 'fiber brow gel', 'soap brow'],
    'powder foundation': ['pressed powder foundation', 'loose powder', 'setting powder', 'banana powder', 'HD powder'],
    'contour kit': ['contouring palette', 'contour stick', 'bronzer contour', 'highlight contour kit'],
    'lip tint': ['lip stain', 'korean lip tint', 'tinted lip balm', 'lip color stain', 'water lip tint'],
    // ── Clothing (expanded) ───────────────────────────────────────────────────────
    'bodysuit': ['long sleeve bodysuit', 'sleeveless bodysuit', 'snap bodysuit', 'body suit top', 'leotard bodysuit'],
    'crop top': ['cropped top', 'cropped tee', 'belly top', 'crop tank top', 'ribbed crop top'],
    'swim trunks': ['board shorts', 'mens swim shorts', 'quick dry trunks', 'surf trunks', 'beach trunks'],
    'boxers': ['boxer shorts', 'boxer underwear', 'cotton boxers', 'woven boxers', 'mens boxers'],
    'briefs': ['mens briefs', 'cotton briefs', 'hipster briefs', 'low rise briefs', 'sport briefs'],
    'chinos': ['chino pants', 'slim chinos', 'cotton chinos', 'stretch chinos', 'khaki chinos'],
    'cargo shorts': ['mens cargo shorts', 'multi pocket shorts', 'tactical shorts', 'utility shorts'],
    'shapewear': ['body shaper', 'tummy control', 'waist cincher', 'shaping shorts', 'control briefs'],
    'maternity clothes': ['maternity dress', 'maternity jeans', 'nursing top', 'pregnancy wear'],
    // ── Home Textiles (expanded) ──────────────────────────────────────────────────
    'table runner': ['dining table runner', 'linen table runner', 'cotton table runner', 'jute table runner'],
    'place mat': ['dining place mat', 'woven placemat', 'silicone placemat', 'bamboo placemat', 'fabric placemat'],
    'cloth napkin': ['linen napkin', 'cotton cloth napkin', 'dinner napkin cloth', 'fabric napkin set'],
    'oven glove': ['oven mitt', 'heat resistant glove', 'silicone oven mitt', 'oven mitten pair'],
    'bath sheet': ['extra large towel', 'jumbo bath towel', 'bath sheet towel', 'oversized bath towel'],
    // ── Storage & Organization (expanded) ────────────────────────────────────────
    'jewelry organizer': ['jewelry box organizer', 'earring display', 'ring holder', 'jewelry tray organizer'],
    'shoe box storage': ['clear shoe box', 'stackable shoe box', 'shoe storage box', 'drop front shoe box'],
    'hat box': ['round hat box', 'travel hat box', 'millinery box', 'wide brim hat box'],
    'collapsible storage box': ['foldable storage box', 'fabric storage cube', 'collapsible cube bin'],
    // ── Cleaning Tools (expanded) ─────────────────────────────────────────────────
    'steam mop': ['floor steam mop', 'steam cleaner mop', 'steam floor cleaner', 'microfiber steam mop'],
    'spin mop': ['mop and bucket set', '360 spin mop', 'twist mop bucket', 'flat spin mop'],
    'toilet plunger': ['sink plunger', 'cup plunger', 'flange plunger', 'accordion plunger', 'heavy duty plunger'],
    'window squeegee': ['glass squeegee', 'shower squeegee', 'car window squeegee', 'extendable squeegee'],
    // ── Woodworking Tools ─────────────────────────────────────────────────────────
    'belt sander': ['electric belt sander', 'portable belt sander', 'bench sander belt', 'sanding belt tool'],
    'orbital sander': ['random orbital sander', 'palm sander', 'detail sander', 'finishing sander'],
    'router tool': ['wood router', 'plunge router', 'trim router', 'fixed base router', 'compact router'],
    'router bit': ['router bit set', 'carbide router bit', 'flush trim bit', 'roundover bit', 'dovetail bit'],
    // ── Craft Supplies (expanded) ─────────────────────────────────────────────────
    'washi tape': ['decorative tape', 'japanese washi tape', 'patterned masking tape', 'craft tape washi'],
    'kraft paper': ['brown kraft paper', 'wrapping kraft paper', 'kraft roll paper', 'packing kraft paper'],
    'bubble wrap': ['protective bubble wrap', 'large bubble wrap', 'small bubble wrap', 'anti static bubble'],
    'tissue paper': ['gift tissue paper', 'wrapping tissue', 'colored tissue paper', 'pom pom tissue'],
    // ── Home Improvement ──────────────────────────────────────────────────────────
    'wallpaper paste': ['wallpaper adhesive', 'paste the wall glue', 'ready mixed paste', 'wallpaper primer paste'],
    'grout': ['tile grout', 'unsanded grout', 'sanded grout', 'epoxy grout', 'premixed grout'],
    'drop cloth': ['canvas drop cloth', 'painting drop cloth', 'plastic drop sheet', 'floor protection sheet'],
    'wood putty': ['wood filler', 'wood repair putty', 'wood grain filler', 'spackle paste'],
    // ── Travel Accessories ────────────────────────────────────────────────────────
    'luggage strap': ['suitcase strap', 'luggage belt strap', 'tsa luggage strap', 'adjustable luggage strap'],
    'luggage scale': ['digital luggage scale', 'handheld scale luggage', 'travel scale', 'portable weighing scale'],
    'rfid wallet': ['rfid blocking wallet', 'rfid card holder', 'identity theft wallet', 'anti rfid purse'],
    'travel organizer': ['packing organizer', 'travel cable organizer', 'travel pouch organizer', 'travel document pouch'],
    // ── Fitness (expanded) ────────────────────────────────────────────────────────
    'resistance tube': ['resistance bands tube', 'exercise tube', 'latex tube band', 'pull tube resistance'],
    'gymnastic rings': ['wooden gym rings', 'olympic gymnastic rings', 'pull up rings', 'calisthenics rings'],
    'weighted vest': ['training vest weight', 'adjustable weighted vest', 'body weight vest', 'loading vest'],
    'speed rope': ['jump speed rope', 'steel cable skipping rope', 'bearing speed rope', 'double under rope'],
    // ── Plumbing ─────────────────────────────────────────────────────────────────
    'pipe wrench': ['plumbing wrench', 'stilson wrench', 'adjustable wrench pipe', 'heavy duty pipe wrench'],
    'ball valve': ['brass ball valve', 'pvc ball valve', 'shut off valve', 'gate valve', 'check valve'],
    'faucet aerator': ['tap aerator', 'water saver aerator', 'swivel aerator', 'kitchen tap aerator'],
    'pvc cement': ['solvent cement', 'pvc pipe glue', 'cpvc cement', 'pipe sealant'],
    // ── Electrical ────────────────────────────────────────────────────────────────
    'wire connector': ['wire nut', 'lever connector', 'wago connector', 'push in connector', 'butt connector'],
    'junction box': ['electrical junction box', 'plastic junction box', 'outdoor junction box', 'weatherproof box'],
    'outlet cover': ['switch plate cover', 'wall plate cover', 'outlet faceplate', 'receptacle cover'],
    'dimmer switch': ['led dimmer', 'rotary dimmer', 'smart dimmer switch', 'trailing edge dimmer'],
    // ── Small Appliances (expanded) ───────────────────────────────────────────────
    'wine cooler': ['wine fridge', 'wine chiller', 'thermoelectric wine cooler', 'dual zone wine cooler'],
    'mini fridge': ['compact fridge', 'bar fridge', 'dorm fridge', 'personal fridge', 'countertop fridge'],
    'chest freezer': ['deep freezer', 'upright freezer', 'garage freezer', 'compact freezer'],
    // ── Audio/AV ──────────────────────────────────────────────────────────────────
    'amplifier': ['stereo amplifier', 'power amplifier', 'integrated amplifier', 'class d amplifier'],
    'dac': ['usb dac', 'audio dac', 'headphone dac', 'portable dac amp', 'hi fi dac'],
    'turntable cartridge': ['phono cartridge', 'stylus replacement', 'record needle', 'mm cartridge'],
    // ── Car Accessories (expanded) ────────────────────────────────────────────────
    'car seat cushion': ['driving seat cushion', 'lumbar seat cushion car', 'cooling car seat pad', 'gel seat cushion'],
    'car organizer': ['trunk organizer', 'back seat organizer', 'car trunk storage', 'seat back organizer'],
    'parking sensor': ['reverse sensor', 'backup sensor', 'ultrasonic parking sensor', 'pdc sensor'],
    'reverse camera': ['backup camera', 'rear view camera', 'reversing camera', 'parking camera'],
    // ── Industrial & Workshop ─────────────────────────────────────────────────────
    'welding machine': ['mig welder', 'tig welder', 'arc welder', 'stick welder', 'inverter welder'],
    'plasma cutter': ['electric plasma cutter', 'cut 40 plasma', 'portable plasma cutter', 'cnc plasma'],
    'laser cutter': ['co2 laser cutter', 'fiber laser cutter', 'desktop laser engraver', 'diode laser cutter'],
    'engine hoist': ['shop crane', 'foldable engine hoist', 'cherry picker hoist', 'engine lift crane'],
    // ── Networking ────────────────────────────────────────────────────────────────
    'mesh network': ['mesh wifi system', 'whole home wifi', 'tri band mesh', 'eero type', 'google nest wifi'],
    'powerline adapter': ['ethernet over power', 'av500 adapter', 'homeplug adapter', 'powerline kit'],
    // ── Medical & Mobility ────────────────────────────────────────────────────────
    'oxygen concentrator': ['portable oxygen concentrator', 'home oxygen machine', 'continuous flow oxygen', 'pulse dose oxygen'],
    'blood pressure cuff': ['bp monitor cuff', 'sphygmomanometer', 'upper arm bp cuff', 'digital bp cuff'],
    'peak flow meter': ['asthma peak flow', 'personal best flow meter', 'mini peak flow meter'],
    'cervical collar': ['neck brace collar', 'foam cervical collar', 'soft neck collar', 'whiplash collar'],
    'bed wedge pillow': ['incline wedge pillow', 'gerd wedge pillow', 'acid reflux wedge', 'triangular pillow wedge'],
    'grab bar': ['bathroom grab rail', 'shower grab bar', 'safety grab bar', 'stainless grab bar'],
    'raised toilet seat': ['toilet raiser', 'elevated toilet seat', 'commode seat raiser', 'toilet frame'],
    // ── Eyewear ───────────────────────────────────────────────────────────────────
    'prescription glasses': ['corrective glasses', 'optical glasses', 'single vision glasses', 'distance glasses'],
    'progressive glasses': ['progressive lenses', 'varifocal glasses', 'multifocal glasses'],
    'safety glasses': ['protective eyewear', 'impact resistant glasses', 'anti fog safety glasses', 'ansi glasses'],
    // ── Watches & Jewelry (expanded) ─────────────────────────────────────────────
    'luxury watch': ['dress watch', 'automatic watch', 'swiss watch', 'sapphire crystal watch'],
    'stainless bracelet': ['steel link bracelet', 'stainless steel bangle', 'metal cuff bracelet'],
    'gemstone ring': ['diamond ring', 'engagement ring', 'sapphire ring', 'ruby ring', 'emerald ring'],
    'gold chain': ['gold necklace chain', '14k gold chain', 'rope chain gold', 'cuban link chain'],
    // ── Home Decor (expanded) ─────────────────────────────────────────────────────
    'wall clock': ['decorative wall clock', 'silent wall clock', 'large wall clock', 'modern wall clock'],
    'accent wall decor': ['wall art piece', 'wall sculpture', 'metal wall decor', 'wood wall art'],
    'throw pillow': ['decorative cushion throw', 'sofa throw pillow', 'lumbar throw pillow'],
    'faux fur': ['faux fur blanket', 'sherpa throw', 'fluffy throw blanket', 'faux fur rug'],
    'table centerpiece': ['dining table decor', 'centerpiece vase', 'decorative bowl table', 'floral centerpiece'],
    // ── Lighting (expanded) ───────────────────────────────────────────────────────
    'track lighting': ['track light system', 'adjustable track light', 'spotlight track', 'rail lighting'],
    'pendant light': ['hanging pendant light', 'ceiling pendant', 'kitchen island pendant', 'dome pendant'],
    'wall sconce': ['bathroom sconce', 'bedside wall light', 'plug in sconce', 'wall mounted light'],
    'outdoor solar light': ['solar garden light', 'solar path light', 'solar stake light', 'solar landscape light'],
    'led strip light': ['rgb strip light', 'bias lighting strip', 'tv backlight strip', 'under cabinet led'],
    // ── Sports Equipment (expanded) ───────────────────────────────────────────────
    'cricket helmet': ['batsman helmet', 'youth cricket helmet', 'cricket head guard'],
    'volleyball': ['beach volleyball', 'indoor volleyball', 'training volleyball', 'soft volleyball'],
    'rugby ball': ['match rugby ball', 'training rugby ball', 'touch rugby ball'],
    'weight lifting belt': ['powerlifting belt', 'gym belt', 'lever belt', 'neoprene belt'],
    'knee sleeve': ['powerlifting knee sleeve', 'neoprene knee sleeve', 'compression knee sleeve'],
    'lifting straps': ['wrist wrap straps', 'deadlift straps', 'cotton lifting straps', 'hook straps'],
    // ── Footwear (expanded) ───────────────────────────────────────────────────────
    'ballet flats': ['flat pumps', 'ballerina shoes', 'pointed flat shoes', 'comfort flats'],
    'mules': ['backless mules', 'slide mule shoes', 'heeled mules', 'clogs mules'],
    'platform shoes': ['platform sneakers', 'chunky platform', 'wedge platform shoes', 'platform heels'],
    'ankle strap heels': ['strappy heels', 'sandal heels', 'block heel strappy', 't strap heels'],
    'boat shoes': ['deck shoes', 'topsider shoes', 'leather boat shoe', 'moc toe shoes'],
    'dress shoes': ['oxford shoes', 'derby shoes', 'formal shoes', 'leather dress shoes'],
    // ── Toys & Games (expanded) ───────────────────────────────────────────────────
    'remote control drone': ['fpv drone', 'racing drone', 'photography drone', 'mini fpv drone'],
    'science kit': ['chemistry set', 'stem kit', 'experiment kit', 'volcano kit', 'crystal growing kit'],
    'puppet': ['hand puppet', 'finger puppet', 'marionette puppet', 'sock puppet'],
    'kite surfing': ['powerkite', 'trainer kite', 'foil kite', 'bar kite'],
    'fidget cube': ['anxiety cube', 'fidget toy cube', 'stress relief cube', 'click cube'],
    // ── Baby & Nursery (expanded) ──────────────────────────────────────────────────
    'bassinet': ['bedside bassinet', 'rocking bassinet', 'portable bassinet', 'moses basket'],
    'nursing pillow': ['breastfeeding pillow', 'boppy pillow type', 'c shaped nursing pillow'],
    'baby bouncer': ['infant bouncer', 'electric bouncer', 'vibrating bouncer', 'newborn bouncer'],
    'bottle warmer': ['baby bottle warmer', 'electric warmer bottle', 'fast bottle warmer'],
    'breast pump': ['electric breast pump', 'double pump breast', 'portable breast pump', 'wearable pump'],
    // ── Candles & Aromatherapy (expanded) ─────────────────────────────────────────
    'soy candle': ['soy wax candle', 'natural soy candle', 'scented soy candle', 'handmade soy candle'],
    'beeswax candle': ['pure beeswax candle', 'natural beeswax', 'pillar beeswax candle'],
    'taper candle': ['long taper candle', 'dinner taper candle', 'unscented taper', 'colored taper'],
    'wooden wick candle': ['wood wick crackling candle', 'crackle wood wick', 'wooden wick soy candle'],
    'aroma diffuser': ['ultrasonic diffuser', 'mist diffuser', 'aromatherapy humidifier', 'nebulizing diffuser'],
    // ── Office & Stationery (expanded) ────────────────────────────────────────────
    'laptop sleeve': ['neoprene laptop sleeve', 'felt laptop sleeve', 'slim laptop case', 'macbook sleeve'],
    'monitor privacy screen': ['privacy filter screen', 'anti spy screen filter', 'monitor filter'],
    'desk cable clip': ['cable organizer clip', 'wire clip adhesive', 'cord clip holder'],
    'ergonomic keyboard': ['split keyboard', 'curved keyboard', 'wrist friendly keyboard', 'ortholinear keyboard'],
    'vertical mouse': ['ergonomic vertical mouse', 'vertical grip mouse', 'wrist rest mouse'],
    // ── Textiles & Fabrics ────────────────────────────────────────────────────────
    'muslin fabric': ['unbleached muslin', 'cotton muslin cloth', 'muslin swaddle', 'gauze fabric'],
    'felt fabric': ['craft felt sheet', 'wool felt fabric', 'adhesive felt', 'foam felt'],
    'fleece fabric': ['polar fleece', 'anti pill fleece', 'sherpa fleece fabric', 'microfleece'],
    'mesh fabric': ['athletic mesh', 'tulle mesh', 'nylon mesh fabric', 'power mesh'],
    // ── Cleaning & Household (expanded) ──────────────────────────────────────────
    'trash compactor': ['waste compactor', 'kitchen compactor', 'garbage compactor'],
    'composting worms': ['red wigglers worms', 'vermicomposting worms', 'worm farm worms'],
    'laundry pods': ['laundry detergent pods', 'washing pods', 'all in one pods', 'eco pods'],
    'wool dryer balls': ['dryer balls', 'reusable dryer balls', 'natural dryer balls', 'xl dryer balls'],
    // ── Outdoor / Patio ───────────────────────────────────────────────────────────
    'fire pit': ['outdoor fire pit', 'propane fire pit', 'wood burning fire pit', 'portable fire pit'],
    'outdoor heater': ['patio heater', 'infrared outdoor heater', 'propane heater patio', 'electric patio heater'],
    'garden statue': ['outdoor garden statue', 'lawn ornament', 'decorative garden figure', 'stone garden statue'],
    'bird bath': ['garden bird bath', 'pedestal bird bath', 'solar bird bath fountain', 'ceramic bird bath'],
    'wind spinner': ['garden wind spinner', 'metal wind spinner', 'kinetic wind sculpture', 'yard spinner'],
    // ── Personal Grooming (expanded) ──────────────────────────────────────────────
    'water flosser': ['oral irrigator', 'electric water flosser', 'teeth flosser water', 'waterpik type'],
    'uv sanitizer': ['uv sterilizer box', 'phone uv sanitizer', 'portable uv lamp sterilizer'],
    'nail lamp': ['uv nail lamp', 'led gel nail lamp', 'nail curing lamp', 'nail dryer lamp'],
    'wax warmer': ['hair removal wax warmer', 'depilatory wax heater', 'wax pot warmer'],
    'epilator': ['electric epilator', 'cordless epilator', 'wet dry epilator', 'facial epilator'],
    'wax strips': ['cold wax strips', 'hair removal strips', 'depilatory strips', 'sugar wax strips'],
    'shaving brush': ['badger shaving brush', 'synthetic shaving brush', 'wet shaving brush', 'lather brush'],
    'shaving bowl': ['lather bowl', 'shaving soap bowl', 'scuttle mug', 'shaving cream bowl'],
    'safety razor': ['double edge razor', 'de razor', 'wet shave razor', 'classic safety razor'],
    'lash serum': ['eyelash growth serum', 'lash boost serum', 'mascara growth serum'],
    'nail gel polish': ['gel nail colour', 'soak off gel', 'uv gel polish', 'shellac gel polish'],
    // ── Coffee & Beverages ────────────────────────────────────────────────────────
    'moka pot': ['stovetop espresso maker', 'italian coffee maker', 'bialetti type', 'espresso moka'],
    'french press': ['coffee press', 'cafetiere', 'plunger coffee', 'double wall french press'],
    'pour over coffee': ['pour over dripper', 'v60 coffee dripper', 'chemex type', 'filter drip coffee'],
    'cold brew maker': ['cold brew coffee maker', 'cold brew pitcher', 'immersion cold brew', 'glass cold brew'],
    'milk frother': ['electric frother', 'handheld frother', 'steam frother wand', 'battery frother'],
    'coffee capsule': ['nespresso capsule', 'k cup pod', 'coffee pod compatible', 'espresso capsule'],
    'yogurt maker': ['electric yogurt maker', 'fermentation maker', 'greek yogurt maker', 'dairy fermentor'],
    // ── Kitchen Gadgets (expanded) ────────────────────────────────────────────────
    'salad spinner': ['salad washing spinner', 'vegetable spinner', 'collapsible salad spinner'],
    'garlic press': ['garlic crusher', 'mincer press garlic', 'stainless garlic press', 'rocker garlic press'],
    'avocado slicer': ['avocado tool', '3 in 1 avocado slicer', 'avocado pit remover', 'avocado masher'],
    'cherry pitter': ['olive pitter', 'cherry stoner', 'pitting tool', 'multi cherry pitter'],
    'citrus juicer': ['lemon squeezer', 'manual citrus press', 'electric citrus juicer', 'orange squeezer'],
    'salad dressing shaker': ['dressing bottle shaker', 'mason jar dressing', 'oil vinegar shaker'],
    'butter dish': ['butter keeper', 'butter crock', 'ceramic butter dish', 'covered butter dish'],
    // ── Home Improvement (expanded) ───────────────────────────────────────────────
    'tile spacer': ['floor tile spacer', 'cross tile spacer', 'grout spacer', '3mm spacer tile'],
    'paint sprayer': ['hvlp paint sprayer', 'electric spray gun', 'airless sprayer', 'garden sprayer'],
    'concrete mix': ['ready mix concrete', 'quikrete mix', 'post hole concrete', 'mortar mix'],
    'mixing bucket': ['builders bucket', 'plaster mixing bucket', 'cement pail', 'contractors bucket'],
    'window blind': ['roller blind', 'venetian blind', 'blackout roller blind', 'zebra blind'],
    'solar film': ['window tint film', 'privacy window film', 'frosted window film', 'uv blocking film'],
    // ── Automotive (expanded) ─────────────────────────────────────────────────────
    'car sunshade': ['windshield sunshade', 'front window shade', 'foldable sunshade', 'uv sun protector'],
    'roof rack': ['car roof rack', 'roof cargo carrier', 'roof luggage rack', 'crossbar roof rack'],
    'bike rack': ['car bike rack', 'hitch bike rack', 'trunk bike rack', 'roof bike rack'],
    'mud flap': ['splash guard', 'mud guard flap', 'rear mud flap', 'universal mud flap'],
    'car tow bar': ['tow hitch', 'hitch receiver', 'trailer hitch', 'towing ball'],
    // ── Musical Instruments (accessories) ────────────────────────────────────────
    'violin rosin': ['bow rosin', 'light rosin', 'dark rosin', 'cello rosin'],
    'guitar case': ['acoustic guitar case', 'hard shell guitar case', 'gig bag guitar', 'electric guitar bag'],
    'keyboard stand': ['x stand keyboard', 'z stand keyboard', 'adjustable keyboard stand', 'double tier stand'],
    'drum throne': ['drum stool', 'padded drum seat', 'adjustable drum throne', 'tractor seat throne'],
    // ── Garden (expanded) ─────────────────────────────────────────────────────────
    'pond pump': ['water pump pond', 'submersible pond pump', 'fountain pump', 'waterfall pump'],
    'solar fountain': ['solar water fountain', 'floating solar fountain', 'bird bath solar pump'],
    'weed puller': ['stand up weed puller', 'weed twister', 'dandelion puller', 'root remover tool'],
    'soaker hose': ['garden soaker hose', 'drip hose soaker', 'leaky hose', 'porous hose'],
    'garden kneeling pad': ['knee pad garden', 'foam kneeler', 'garden kneepad', 'gardening pad'],
    // ── Food Specialties ─────────────────────────────────────────────────────────
    'dried mushroom': ['shiitake dried', 'porcini dried', 'mixed dried mushroom', 'mushroom powder'],
    'coconut oil': ['virgin coconut oil', 'organic coconut oil', 'refined coconut oil', 'raw coconut oil'],
    'ghee': ['clarified butter ghee', 'grass fed ghee', 'organic ghee', 'desi ghee'],
    'kimchi': ['korean kimchi', 'fermented cabbage', 'kimchi jar', 'vegan kimchi'],
    'protein granola': ['high protein granola', 'keto granola', 'low sugar granola', 'nut granola'],
    'nut mix': ['mixed nuts snack', 'trail mix', 'roasted nut mix', 'salted nut mix'],
    // ── Bags & Luggage (expanded) ─────────────────────────────────────────────────
    'laptop backpack': ['computer backpack', 'work backpack', '15 inch laptop bag', 'business backpack'],
    'anti theft backpack': ['slash proof bag', 'lockable backpack', 'secure backpack', 'pacsafe type'],
    'toiletry bag': ['dopp kit', 'wash bag travel', 'grooming bag', 'cosmetic travel bag'],
    'cosmetic bag': ['makeup pouch', 'beauty bag', 'clear cosmetic bag', 'makeup organizer bag'],
    // ── Electronics (expanded) ────────────────────────────────────────────────────
    'gps tracker': ['vehicle gps tracker', 'asset tracker', 'location tracker', 'magnetic gps'],
    'smart display': ['smart screen', 'echo show type', 'google nest display', 'touchscreen smart hub'],
    'portable projector': ['mini projector portable', 'pocket projector', 'pico projector', 'led mini projector'],
    'document holder': ['copy holder', 'monitor document holder', 'typing copy holder', 'paper stand holder'],
    'balance board': ['wobble board', 'balance disc', 'rocker balance board', 'standing balance board'],
    'standing desk converter': ['desktop riser', 'sit stand converter', 'adjustable riser desk', 'z lift desk riser'],
    // ── Wellness & Mindfulness ────────────────────────────────────────────────────
    'acupressure mat': ['spike mat', 'acupuncture mat', 'pranamat type', 'lotus mat acupressure'],
    'foam roller half': ['half round roller', 'balance roller', 'step roller', 'trigger point half'],
    'inversion table': ['back inversion table', 'gravity table', 'inverter therapy table', 'teeter type'],
    'sauna blanket': ['infrared sauna blanket', 'portable infrared sauna', 'sauna bag', 'heat blanket sauna'],
    'weighted blanket': ['gravity blanket', 'heavy blanket', '15lb weighted blanket', 'calming blanket'],
    // ── Home & Organization (expanded) ───────────────────────────────────────────
    'storage ottoman': ['ottoman storage box', 'bench ottoman storage', 'round storage ottoman'],
    'floating shelves': ['wall floating shelf', 'invisible shelf', 'picture ledge shelf', 'box floating shelf'],
    'under bed storage': ['under bed box', 'rolling under bed storage', 'flat storage container', 'under bed roller'],
    'closet system': ['wardrobe organiser', 'closet organiser shelves', 'modular closet', 'wire shelf closet'],
    'toilet paper stand': ['tissue roll holder', 'free standing toilet roll', 'bamboo tissue holder'],
    // ── Baby Feeding ──────────────────────────────────────────────────────────────
    'sippy cup': ['toddler sippy cup', 'spout cup baby', 'straw sippy cup', '360 cup toddler'],
    'highchair tray': ['high chair insert', 'booster seat tray', 'clip on chair tray'],
    'baby food maker': ['baby food processor', 'infant food steamer blender', 'baby blender'],

    // ── Batch 11: Outdoor/Patio, Kitchen Specialties, Electronics, Fashion, Sports, Music, Art, Auto, Health ──
    // Outdoor & Patio
    'pergola': ['garden pergola', 'patio pergola', 'wood pergola', 'metal pergola', 'pergola kit'],
    'gazebo': ['garden gazebo', 'pop up gazebo', 'hardtop gazebo', 'canopy gazebo', 'party gazebo'],
    'outdoor rug': ['patio rug', 'deck rug', 'all weather rug', 'indoor outdoor mat', 'polypropylene outdoor rug'],
    'deck box': ['outdoor storage box', 'patio storage chest', 'garden storage box', 'resin deck box'],
    'hammock stand': ['portable hammock stand', 'steel hammock stand', 'hammock frame', 'freestanding hammock'],
    'outdoor umbrella': ['patio umbrella', 'garden umbrella', 'cantilever umbrella', 'beach umbrella stand'],
    'outdoor lantern': ['solar garden lantern', 'hanging outdoor lantern', 'patio lantern', 'led outdoor lantern'],
    'planters box': ['raised garden bed', 'planter trough', 'elevated planter', 'window planter box'],
    // Kitchen Specialties
    'egg cooker': ['electric egg cooker', 'egg boiler', 'rapid egg cooker', 'egg steamer'],
    'electric wok': ['electric frying pan', 'wok electric', 'non-stick electric wok', 'skillet electric'],
    'food vacuum sealer': ['vacuum sealer machine', 'food sealer', 'sous vide vacuum sealer', 'bag sealer'],
    // Electronics Accessories
    'usb c hub': ['usb-c hub', 'type c hub', 'multiport hub usb c', 'usb c docking station', 'usb c adapter hub'],
    'external ssd': ['portable ssd', 'external solid state drive', 'usb ssd', 'pocket ssd drive'],
    'nvme drive': ['m.2 nvme ssd', 'm2 ssd drive', 'nvme solid state', 'pcie nvme drive'],
    'hdmi switch': ['hdmi splitter switch', 'hdmi selector', '4k hdmi switch', 'automatic hdmi switch'],
    'wireless charging pad': ['qi charging pad', 'fast wireless charger pad', 'charging mat wireless'],
    'laptop docking station': ['usb c docking station', 'laptop dock', 'thunderbolt dock', 'universal docking station'],
    'smart doorbell': ['video doorbell wifi', 'ring doorbell', 'nest doorbell', 'wireless video doorbell'],
    'smart thermostat': ['wifi thermostat', 'programmable thermostat smart', 'nest thermostat', 'ecobee'],
    // Fashion Accessories
    'hair claw clip': ['claw clip hair', 'jaw clip', 'large claw clip', 'shark clip hair'],
    'silk scarf': ['satin scarf', 'square silk scarf', 'head silk scarf', 'printed silk scarf'],
    'pocket square': ['handkerchief pocket', 'suit pocket square', 'fold pocket square'],
    'money clip': ['slim money clip', 'metal money clip', 'magnetic money clip'],
    'coin purse': ['small coin wallet', 'change purse', 'zip coin pouch', 'mini coin bag'],
    'phone lanyard': ['neck lanyard phone', 'crossbody phone strap', 'lanyard card holder'],
    'watch winder': ['automatic watch winder', 'watch winder box', 'watch rotation winder', 'dual watch winder'],
    'glasses case': ['eyeglass case', 'spectacle case', 'hard glasses case', 'sunglass hard case'],
    'shoe bag': ['dust bag shoes', 'travel shoe bag', 'shoe storage bag', 'drawstring shoe bag'],
    // Sports & Outdoor
    'tennis racket': ['tennis racquet', 'adult tennis racket', 'beginners tennis racket', 'graphite racket'],
    'badminton racket': ['badminton racquet', 'badminton set', 'lightweight badminton racket', 'carbon badminton'],
    'table tennis paddle': ['ping pong paddle', 'table tennis bat', 'tt paddle', 'ping pong racket'],
    'squash racket': ['squash racquet', 'graphite squash racket', 'beginner squash racket'],
    'frisbee': ['flying disc', 'ultimate frisbee', 'sport disc', 'disc golf frisbee'],
    'cricket ball': ['leather cricket ball', 'match cricket ball', 'red cricket ball'],
    'swimming fins': ['dive fins', 'training fins', 'snorkel fins', 'freediving fins'],
    'golf tee': ['wooden golf tee', 'rubber golf tee', 'castle golf tee', 'golf tees pack'],
    'ski poles': ['alpine ski poles', 'downhill ski poles', 'carbon ski poles', 'adjustable ski poles'],
    'snowboard boots': ['snowboard boot', 'boots snowboarding', 'freestyle snowboard boots'],
    'cycling gloves': ['bike gloves', 'bicycle gloves', 'cycling mitts', 'gel cycling gloves'],
    'boxing hand wraps': ['hand wraps boxing', 'inner gloves boxing', 'wrist wraps boxing'],
    'gymnastics mat': ['gym mat folding', 'gymnastic panel mat', 'tumbling mat'],
    // Music
    'cajon drum': ['cajon box drum', 'wooden cajon', 'flamenco cajon', 'cajon percussion'],
    'bongo drums': ['bongos', 'bongo set', 'latin bongos', 'hand bongos'],
    'kalimba': ['thumb piano', 'mbira', '17 key kalimba', '10 key kalimba', 'finger piano'],
    'instrument case': ['hard instrument case', 'padded instrument bag', 'instrument gig bag'],
    // Art & Craft
    'linoleum block': ['linocut block', 'lino printing block', 'carving block art', 'rubber stamp block'],
    'airbrush kit': ['airbrush set', 'mini airbrush compressor', 'dual action airbrush', 'airbrush gun'],
    'polymer clay': ['oven bake clay', 'fimo clay', 'sculpey clay', 'modeling clay oven'],
    'wire wrapping': ['wire wrap jewelry', 'copper wire gauge', 'jewelry wire coil', 'wire for crafts'],
    'weaving loom': ['tapestry loom', 'rigid heddle loom', 'frame loom', 'peg loom weaving'],
    'resin pigment': ['epoxy pigment powder', 'mica powder resin', 'color pigment epoxy', 'resin dye'],
    'alcohol ink': ['alcohol ink art', 'yupo paper ink', 'fluid art alcohol', 'isopropyl art ink'],
    // Automotive
    'led headlight': ['led headlight bulb', 'h7 led headlight', 'h11 led bulb', 'automotive led headlight'],
    'obd2 scanner': ['obd ii scanner', 'car diagnostic scanner', 'elm327 bluetooth', 'obdii reader'],
    'steering wheel lock': ['car anti theft bar', 'club steering lock', 'security wheel lock'],
    // Health & Medical
    'cpap supplies': ['cpap mask', 'cpap tubing', 'cpap filters', 'cpap accessories'],
    'knee walker': ['knee scooter', 'leg cast walker', 'knee roller', 'orthopedic knee walker'],
    'back massager': ['back massage wand', 'percussion back massager', 'shiatsu back massager', 'heated back massager'],
    'eye massager': ['electric eye massager', 'eye mask massager', 'heated eye massager', 'eye pressure massager'],
    'pain relief patch': ['heat patch back pain', 'menthol patch pain', 'pain relief plaster', 'muscle pain patch'],
    // Baby & Kids
    'wooden train set': ['toy train set wood', 'kids railway set', 'toddler train track', 'wooden train track'],
    'play kitchen': ['kids play kitchen', 'pretend kitchen toy', 'toy kitchen set', 'wooden play kitchen'],
    'dollhouse': ['doll house', 'kids dollhouse', 'wooden dollhouse', 'barbie dollhouse'],
    'learning tower': ['kitchen helper stool', 'toddler tower', 'montessori tower', 'kids step stool tower'],
    'shape sorter': ['shape sorting toy', 'sorting cube baby', 'shape puzzle toddler'],
    'sensory toy': ['sensory fidget toy', 'autism sensory toy', 'baby sensory mat', 'montessori sensory'],
    'kids backpack': ['toddler backpack', 'school bag kids', 'children rucksack', 'kids school backpack'],
    // Food Specialties
    'tempeh': ['soy tempeh', 'organic tempeh', 'fermented soy tempeh'],
    'harissa': ['harissa paste', 'hot harissa', 'north african chili paste', 'harissa sauce'],
    'pesto sauce': ['basil pesto', 'green pesto', 'genovese pesto', 'pesto jar'],
    'bone broth': ['chicken bone broth', 'beef bone broth', 'collagen broth', 'bone broth powder'],
    // Textiles & Fabric
    'cashmere sweater': ['cashmere knit', 'pure cashmere pullover', 'cashmere cardigan', 'cashmere jumper'],
    'merino wool': ['merino wool base layer', 'merino jumper', 'merino wool socks', 'merino t shirt'],
    'bamboo pillow': ['shredded memory foam bamboo', 'bamboo pillow case', 'bamboo viscose pillow'],
    'flannel sheet': ['flannel bed sheet', 'plaid flannel sheet', 'brushed cotton flannel sheet'],
    'linen fabric': ['linen cloth', 'pure linen fabric', 'softened linen fabric', 'linen roll'],
    'suede fabric': ['faux suede fabric', 'microsuede fabric', 'suede cloth', 'suede upholstery fabric'],
    // Home Improvement
    'weather stripping': ['door weather seal', 'window weather strip', 'foam weather stripping', 'door seal strip'],
    'door sweep': ['door bottom seal', 'draft door sweep', 'automatic door sweep', 'under door seal'],
    'pipe insulation': ['foam pipe wrap', 'plumbing pipe insulation', 'copper pipe insulation foam'],
    'foam insulation': ['spray foam insulation', 'expanding foam', 'sealant foam spray', 'polyurethane foam'],
    // Industrial / Workshop
    'bench vise': ['metalworking vise', 'woodworking bench vise', 'multi jaw vise', 'swivel bench vise'],
    'crimping tool': ['wire crimper', 'cable crimper', 'electrical crimping tool', 'ratchet crimper'],
    'soldering flux': ['flux paste solder', 'rosin flux pen', 'no clean flux', 'solder flux gel'],
    // Camping / Outdoor
    'camp lantern': ['led camp lantern', 'solar lantern camping', 'hanging camp lantern', 'propane lantern'],
    'bivvy bag': ['bivy sack', 'emergency bivy', 'ultralight bivy', 'sleeping bag liner bivy'],
    'water purification': ['water purifier tablet', 'water filter straw', 'lifestraw', 'camp water filter'],
    'camp kitchen': ['camp cookset', 'camp cooking kit', 'backpacking kitchen set', 'camp cook set'],
    'trekking backpack': ['hiking backpack 50l', 'trail backpack', 'expedition pack', 'mountaineering pack'],
  };

  // ── Audit test hooks (scripts/synonym-audit.ts ONLY — never call in production) ──
  // These methods mutate QUERY_SYNONYMS on this singleton. Since the audit script
  // runs as a standalone NestJS context with no concurrent HTTP requests, mutation
  // is safe in that offline context. Do NOT call from any request-handling code path.
  setSynonymOverride(key: string, synonyms: string[]): void {
    this.QUERY_SYNONYMS[key] = synonyms;
  }

  restoreSynonym(key: string, originalSynonyms: string[]): void {
    this.QUERY_SYNONYMS[key] = originalSynonyms;
  }

  // Returns a deep copy so callers cannot accidentally mutate internal synonym arrays.
  getAllSynonyms(): Record<string, string[]> {
    return Object.fromEntries(
      Object.entries(this.QUERY_SYNONYMS).map(([k, v]) => [k, [...v]]),
    );
  }

  /**
   * Compute the intent rule IDs that fire for a given query string.
   * Used by feedback logging (Phase 5) to attribute failures to rules.
   */
  computeMatchedRuleIds(query: string): string[] {
    const normalizedQuery = this.normalizeQuery(query);
    if (!normalizedQuery) return [];
    const queryTokens = this.tokenizeQuery(normalizedQuery);
    return this.intentRuleService.matchRules(new Set(queryTokens), normalizedQuery.toLowerCase()).map((r) => r.id);
  }

  /**
   * Return the top-N HTS numbers from semantic (embedding) search only — no
   * keyword fusion, no reranking.  Used by eval-recall-at-30.ts to measure
   * whether the correct entry appears in the raw semantic candidate pool.
   */
  async getSemanticCandidates(query: string, limit = 30): Promise<string[]> {
    const normalized = this.normalizeQuery(query);
    if (!normalized) return [];
    const candidates = await this.semanticSearch(normalized, limit);
    return candidates.map((c) => c.htsNumber);
  }

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    @Optional() private readonly embeddingService: EmbeddingService,
    private readonly intentRuleService: IntentRuleService,
  ) {}

  /**
   * Fast keyword-only HTS search — no embedding, no DGX rerank.
   * Used by the OpenAI agent path where sub-second search latency matters.
   * Runs PostgreSQL full-text search + scoring and returns top results.
   */
  async fastTextSearch(query: string, limit: number = 10): Promise<any[]> {
    const normalizedQuery = this.normalizeQuery(query);
    const safeLimit = this.clampLimit(limit, 10);
    if (!normalizedQuery) return [];

    const queryTokens = this.tokenizeQuery(normalizedQuery);
    const matchedRules = this.intentRuleService.matchRules(new Set(queryTokens), normalizedQuery.toLowerCase());
    const lexicalTokens = this.applyLexicalFiltering(queryTokens, matchedRules);
    const expandedTokens = this.expandQueryTokens(lexicalTokens);

    const keywordCandidates = await this.searchByKeyword(
      normalizedQuery,
      Math.min(this.MAX_LIMIT, safeLimit * 4),
      expandedTokens,
    );
    if (keywordCandidates.length === 0) return [];

    const htsNumbers = keywordCandidates.map((r) => r.htsNumber);
    const entries = await this.htsRepository.find({
      where: { htsNumber: In(htsNumbers), isActive: true },
      select: ['htsNumber', 'description', 'chapter', 'indent', 'fullDescription'],
    });
    const entryByHts = new Map(entries.map((e) => [e.htsNumber, e]));

    const scored = keywordCandidates
      .map((r) => {
        const entry = entryByHts.get(r.htsNumber);
        if (!entry) return null;
        const coverage = this.computeCoverageScore(queryTokens, this.buildEntryText(entry));
        const phraseBoost = this.computePhraseBoost(normalizedQuery, this.buildEntryText(entry));
        const specificityBoost = this.computeSpecificityBoost(entry.htsNumber);
        const genericPenalty = this.computeGenericPenalty(entry.description, coverage);
        const tokenSet = this.buildEntryTokenSet(entry);
        const intentBoost = this.computeRuleBoost(entry, tokenSet, matchedRules);
        const intentPenalty = this.computeRulePenalty(entry, tokenSet, matchedRules);
        return {
          htsNumber: entry.htsNumber,
          description: entry.description ?? '',
          chapter: entry.chapter,
          indent: entry.indent,
          fullDescription: entry.fullDescription ?? null,
          score: r.score + coverage * 0.7 + phraseBoost + specificityBoost - genericPenalty + intentBoost - intentPenalty,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (b.score === a.score ? a.htsNumber.localeCompare(b.htsNumber) : b.score - a.score));

    return scored.slice(0, safeLimit);
  }

  async hybridSearch(query: string, limit: number = 20): Promise<any[]> {
    const normalizedQuery = this.normalizeQuery(query);
    const safeLimit = this.clampLimit(limit, 20);
    if (!normalizedQuery) {
      return [];
    }

    const queryTokens = this.tokenizeQuery(normalizedQuery);
    const matchedRules = this.intentRuleService.matchRules(new Set(queryTokens), normalizedQuery.toLowerCase());
    const matchedRuleIds = new Set(matchedRules.map((r) => r.id));
    const lexicalTokens = this.applyLexicalFiltering(queryTokens, matchedRules);
    const expandedTokens = this.expandQueryTokens(lexicalTokens);

    const candidateLimit = Math.min(this.MAX_LIMIT, safeLimit * 4);

    const [keywordResults, semanticResults] = await Promise.all([
      this.searchByKeyword(normalizedQuery, candidateLimit, expandedTokens),
      this.semanticSearch(normalizedQuery, candidateLimit),
    ]);

    const combined = this.combineResults(
      semanticResults,
      keywordResults,
      candidateLimit,
    );
    if (combined.length === 0) {
      return [];
    }

    const htsNumbers = combined.map((result) => result.htsNumber);
    const entries = await this.htsRepository.find({
      where: {
        htsNumber: In(htsNumbers),
        isActive: true,
      },
      select: ['htsNumber', 'description', 'chapter', 'indent', 'fullDescription'],
    });
    const entryByHts = new Map(
      entries.map((entry) => [entry.htsNumber, entry]),
    );

    const reranked = combined
      .map((result) => {
        const entry = entryByHts.get(result.htsNumber);
        if (!entry) {
          return null;
        }

        const coverage = this.computeCoverageScore(
          queryTokens,
          this.buildEntryText(entry),
        );
        const phraseBoost = this.computePhraseBoost(
          normalizedQuery,
          this.buildEntryText(entry),
        );
        const specificityBoost = this.computeSpecificityBoost(entry.htsNumber);
        const genericPenalty = this.computeGenericPenalty(
          entry.description,
          coverage,
        );
        const tokenSet = this.buildEntryTokenSet(entry);
        if (!this.applyRuleWhitelist(entry, tokenSet, matchedRules, matchedRuleIds)) {
          return null;
        }
        const intentBoost = this.computeRuleBoost(entry, tokenSet, matchedRules);
        const intentPenalty = this.computeRulePenalty(entry, tokenSet, matchedRules);

        const score =
          result.score +
          coverage * 0.7 +
          phraseBoost +
          specificityBoost -
          genericPenalty +
          intentBoost -
          intentPenalty;

        return {
          htsNumber: entry.htsNumber,
          description: entry.description ?? '',
          chapter: entry.chapter,
          indent: entry.indent,
          fullDescription: entry.fullDescription ?? null,
          score,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      );

    const diversifiedRows = this.applyChapterDiversity(
      reranked,
      safeLimit,
      expandedTokens.length >= 3,
    );

    // Normalize against a fixed reference score so displayed percentages reflect
    // absolute match quality, not just relative rank within potentially weak results.
    // hybridSearch coverage weight is 0.7 vs autocomplete's 0.85; reference adjusted.
    const REFERENCE_GOOD_SCORE = 0.95;
    const finalRows = diversifiedRows.slice(0, safeLimit);
    const maxScore = finalRows.length > 0 ? Math.max(...finalRows.map((r) => r.score)) : 0;
    if (maxScore <= 0) {
      return finalRows;
    }
    const normalizeBase = Math.max(maxScore, REFERENCE_GOOD_SCORE);
    return finalRows.map((r) => ({
      ...r,
      score: Math.max(r.score, 0) / normalizeBase,
    }));
  }

  async autocomplete(query: string, limit: number = 10): Promise<any[]> {
    const normalizedQuery = this.normalizeQuery(query);
    const safeLimit = this.clampLimit(limit, 10);
    if (normalizedQuery.length < 2) {
      return [];
    }

    const intent = this.classifyQueryIntent(normalizedQuery);
    if (intent === 'code') {
      // Use pattern matching for HTS code queries
      return this.autocompleteByCode(normalizedQuery, safeLimit);
    }

    return this.autocompleteByTextHybrid(
      normalizedQuery,
      safeLimit,
      intent === 'mixed',
    );
  }

  /**
   * Autocomplete by HTS code pattern matching
   */
  private async autocompleteByCode(
    query: string,
    limit: number,
  ): Promise<any[]> {
    const normalizedCode = query.replace(/[^\d]/g, '');
    const containsQuery = `%${query}%`;
    const prefixQuery = `${query}%`;
    const normalizedPrefix = `${normalizedCode}%`;
    const normalizedContains = `%${normalizedCode}%`;

    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect('hts.description', 'description')
      .addSelect('hts.chapter', 'chapter')
      .addSelect('hts.indent', 'indent')
      .addSelect(
        `CASE
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') = :normalizedCode THEN 1.0
          WHEN hts.htsNumber ILIKE :prefixQuery THEN 0.96
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') LIKE :normalizedPrefix THEN 0.94
          WHEN hts.htsNumber ILIKE :containsQuery THEN 0.5
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') LIKE :normalizedContains THEN 0.45
          ELSE 0
        END`,
        'score',
      )
      .where('hts.isActive = :active', { active: true })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
      .andWhere("hts.chapter NOT IN ('98', '99')")

      .andWhere(
        new Brackets((qb) => {
          qb.where('hts.htsNumber ILIKE :containsQuery', { containsQuery });
          if (normalizedCode) {
            qb.orWhere(
              "REPLACE(hts.htsNumber, '.', '') LIKE :normalizedContains",
              {
                normalizedContains,
              },
            );
          }
        }),
      )
      .setParameters({
        normalizedCode,
        prefixQuery,
        normalizedPrefix,
        containsQuery,
        normalizedContains,
      })
      .orderBy('score', 'DESC')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => ({
      htsNumber: row.htsNumber,
      description: row.description,
      chapter: row.chapter,
      indent: Number(row.indent) || 0,
      score: Number(row.score) || 0,
    }));
  }

  /**
   * Semantic search using pgvector cosine similarity.
   * Automatically selects the correct column based on the active embedding provider:
   *   SEARCH_EMBEDDING_PROVIDER=dgx    → hts.embedding (vector(1024))
   *   SEARCH_EMBEDDING_PROVIDER=openai → hts.embedding_openai (vector(1536))
   *
   * Errors are caught and logged — semantic failure degrades to keyword-only gracefully.
   */
  private async semanticSearch(
    query: string,
    limit: number,
  ): Promise<SemanticCandidate[]> {
    if (!this.embeddingService) return [];
    try {
      // column   = snake_case DB column name — used in raw SQL addSelect expressions
      // property = camelCase TypeORM property name — used in andWhere/orderBy so
      //            TypeORM resolves it through the NamingStrategy correctly.
      //            Using the snake_case column name in andWhere throws:
      //            TypeError: Cannot read properties of undefined (reading 'databaseName')
      const { column, property }: EmbeddingProviderConfig = this.embeddingService.providerInfo;
      const embedding = await this.embeddingService.generateEmbedding(query);
      const rows = await this.htsRepository
        .createQueryBuilder('hts')
        .select('hts.htsNumber', 'htsNumber')
        .addSelect(`1 - (hts.${column} <=> :embedding)`, 'similarity')
        .where('hts.isActive = :active', { active: true })
        .andWhere(`hts.${property} IS NOT NULL`)
        .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
        .andWhere("hts.chapter NOT IN ('98', '99')")
        .setParameter('embedding', JSON.stringify(embedding))
        .orderBy('similarity', 'DESC')
        .limit(limit)
        .getRawMany<{ htsNumber: string; similarity: string }>();
      return rows.map((r) => ({
        htsNumber: r.htsNumber,
        similarity: parseFloat(r.similarity),
      }));
    } catch (err) {
      this.logger.warn(
        `Semantic search failed (provider=${this.embeddingService?.providerInfo.provider}), skipping: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Semantic search restricted to a set of chapters.
   * Used by the smart-classify pipeline to narrow candidates after chapter identification.
   * Returns full HTS entry details ordered by embedding similarity.
   */
  async semanticSearchInChapters(
    query: string,
    chapters: string[],
    limit: number,
  ): Promise<Array<{ htsNumber: string; description: string; chapter: string; indent: number; fullDescription: string[] | null; similarity: number }>> {
    if (!this.embeddingService || !chapters.length) return [];
    try {
      const { column, property }: EmbeddingProviderConfig = this.embeddingService.providerInfo;
      const embedding = await this.embeddingService.generateEmbedding(query);
      const rows = await this.htsRepository
        .createQueryBuilder('hts')
        .select('hts.htsNumber', 'htsNumber')
        .addSelect(`1 - (hts.${column} <=> :embedding)`, 'similarity')
        .where('hts.isActive = :active', { active: true })
        .andWhere(`hts.${property} IS NOT NULL`)
        .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
        .andWhere('hts.chapter = ANY(:chapters)', { chapters })
        .setParameter('embedding', JSON.stringify(embedding))
        .orderBy('similarity', 'DESC')
        .limit(limit)
        .getRawMany<{ htsNumber: string; similarity: string }>();

      if (!rows.length) return [];

      const htsNumbers = rows.map((r) => r.htsNumber);
      const simMap = new Map(rows.map((r) => [r.htsNumber, parseFloat(r.similarity)]));
      const entries = await this.htsRepository.find({
        where: { htsNumber: In(htsNumbers), isActive: true },
        select: ['htsNumber', 'description', 'chapter', 'indent', 'fullDescription'],
      });
      return entries.map((e) => ({
        htsNumber: e.htsNumber,
        description: e.description ?? '',
        chapter: e.chapter,
        indent: Number(e.indent) || 0,
        fullDescription: e.fullDescription ?? null,
        similarity: simMap.get(e.htsNumber) ?? 0,
      }));
    } catch (err) {
      this.logger.warn(`semanticSearchInChapters failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async autocompleteByTextHybrid(
    query: string,
    limit: number,
    includeCodeCandidates: boolean,
  ): Promise<any[]> {
    const baseTokens = this.tokenizeQuery(query);
    const matchedRules = this.intentRuleService.matchRules(new Set(baseTokens), query.toLowerCase());
    const matchedRuleIds = new Set(matchedRules.map((r) => r.id));
    const lexicalTokens = this.applyLexicalFiltering(baseTokens, matchedRules);
    const expandedTokens = this.expandQueryTokens(lexicalTokens);
    const candidateLimit = Math.min(this.MAX_LIMIT, Math.max(limit * 5, 30));

    const lexicalPromise = this.autocompleteByFullText(
      query,
      candidateLimit,
      expandedTokens,
    );
    const codePromise = includeCodeCandidates
      ? this.autocompleteByCode(query, Math.min(candidateLimit, 20))
      : Promise.resolve([] as any[]);
    const semanticPromise = this.semanticSearch(
      query,
      candidateLimit,
    );

    const [lexicalRows, codeRows, semanticRows] = await Promise.all([
      lexicalPromise,
      codePromise,
      semanticPromise,
    ]);

    const fused = new Map<string, number>();
    lexicalRows.forEach((row, index) => {
      fused.set(row.htsNumber, (fused.get(row.htsNumber) || 0) + this.rrf(index));
    });
    codeRows.forEach((row, index) => {
      fused.set(row.htsNumber, (fused.get(row.htsNumber) || 0) + this.rrf(index));
    });
    semanticRows.forEach((row, index) => {
      fused.set(row.htsNumber, (fused.get(row.htsNumber) || 0) + this.rrf(index));
    });

    if (fused.size === 0) {
      return [];
    }

    // For specific intents, the correct entries may not surface in the semantic/lexical
    // candidate pools (due to vocabulary mismatch). Inject them with a synthetic baseline
    // RRF score so they can receive intent boosts and compete in the final ranking.
    await this.injectRuleCandidates(fused, matchedRules);

    const htsNumbers = [...fused.keys()];
    const entries = await this.htsRepository.find({
      where: { htsNumber: In(htsNumbers), isActive: true },
      select: ['htsNumber', 'description', 'chapter', 'indent', 'fullDescription'],
    });
    const entryByHts = new Map(entries.map((entry) => [entry.htsNumber, entry]));

    const ranked = htsNumbers
      .map((htsNumber) => {
        const entry = entryByHts.get(htsNumber);
        if (!entry) {
          return null;
        }
        // Chapters 98 and 99 are special-use provisions (duty-free programs,
        // temporary imports, etc.) and are not valid classification targets.
        if (entry.chapter === '98' || entry.chapter === '99') {
          return null;
        }
        const base = fused.get(htsNumber) || 0;
        const text = this.buildEntryText(entry);
        // Use expandedTokens for coverage so that synonym-expanded HTS vocabulary terms
        // (e.g. "usb"→"electric","conductor") raise the coverage against entries whose
        // fullDescription contains HTS terms but not the original consumer product word.
        // This prevents computeGenericPenalty from unfairly penalising correct "Other"
        // leaf codes (e.g. 8544.42.90.90) when the query includes terms like "USB charging".
        const coverage = this.computeCoverageScore(expandedTokens, text);
        const phraseBoost = this.computePhraseBoost(query, text);
        const specificityBoost = this.computeSpecificityBoost(htsNumber);
        const genericPenalty = this.computeGenericPenalty(
          entry.description,
          coverage,
        );
        const tokenSet = this.buildEntryTokenSet(entry);
        if (!this.applyRuleWhitelist(entry, tokenSet, matchedRules, matchedRuleIds)) {
          return null;
        }
        const intentBoost = this.computeRuleBoost(entry, tokenSet, matchedRules);
        const intentPenalty = this.computeRulePenalty(entry, tokenSet, matchedRules);

        return {
          htsNumber: entry.htsNumber,
          description: entry.description ?? '',
          chapter: entry.chapter,
          indent: Number(entry.indent) || 0,
          fullDescription: entry.fullDescription ?? null,
          score:
            base +
            coverage * 0.85 +
            phraseBoost +
            specificityBoost -
            genericPenalty +
            intentBoost -
            intentPenalty,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      );

    if (ranked.length === 0) {
      return [];
    }

    // Normalize against a fixed reference score representing a strong match:
    //   RRF(0) ≈ 0.02 + full coverage (0.85) + phrase boost (0.2) + specificity (0.12) ≈ 1.19
    // Using max(actual_max, REFERENCE) prevents a weak result pool from inflating all scores
    // to 100% when no candidate is actually a good match.
    const REFERENCE_GOOD_SCORE = 1.0;
    const maxScore = Math.max(...ranked.map((r) => r.score));
    if (maxScore <= 0) {
      return [];
    }
    const normalizeBase = Math.max(maxScore, REFERENCE_GOOD_SCORE);
    const normalized = ranked
      .map((r) => ({ ...r, score: Math.max(r.score, 0) / normalizeBase }))
      .filter((r) => r.score >= 0.25);

    const diversified = this.applyChapterDiversity(
      normalized,
      limit,
      expandedTokens.length >= 3,
    );

    return diversified.slice(0, limit);
  }

  /**
   * Autocomplete by full-text search.
   * Strategy:
   *  1. Try AND of all words (most precise).
   *  2. Fallback: OR of all words — ts_rank scores by how many words match,
   *     so "comic books" entries outrank "transformer"-only entries.
   *     This avoids the progressive-drop pitfall where "transformer comic books"
   *     degenerates to just "books" or "transformer" alone.
   */
  private async autocompleteByFullText(
    query: string,
    limit: number,
    expandedTokens?: string[],
  ): Promise<any[]> {
    const words =
      expandedTokens && expandedTokens.length > 0
        ? expandedTokens
        : this.expandQueryTokens(this.tokenizeQuery(query));
    if (words.length === 0) return [];

    const andQuery = this.buildTsQuery(words, '&');
    const orQuery = this.buildTsQuery(words, '|');
    const results = new Map<string, any>();

    if (andQuery) {
      try {
        const rows = await this.executeFullTextQuery(andQuery, limit);
        for (const row of rows) {
          results.set(row.htsNumber, row);
        }
      } catch {
        // ignore invalid tsquery
      }
    }

    if (orQuery) {
      try {
        const rows = await this.executeFullTextQuery(orQuery, limit);
        for (const row of rows) {
          const existing = results.get(row.htsNumber);
          if (!existing || row.score > existing.score) {
            results.set(row.htsNumber, row);
          }
        }
      } catch {
        // ignore invalid tsquery
      }
    }

    return [...results.values()]
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      )
      .slice(0, limit);
  }

  private async executeFullTextQuery(
    tsquery: string,
    limit: number,
  ): Promise<any[]> {
    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect('hts.description', 'description')
      .addSelect('hts.chapter', 'chapter')
      .addSelect('hts.indent', 'indent')
      .addSelect(
        `ts_rank_cd(hts.searchVector, to_tsquery('english', :tsquery))`,
        'score',
      )
      .where('hts.isActive = :active', { active: true })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
      .andWhere("hts.chapter NOT IN ('98', '99')")
      .andWhere(`hts.searchVector @@ to_tsquery('english', :tsquery)`)
      .setParameters({ tsquery })
      .orderBy('score', 'DESC')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => ({
      htsNumber: row.htsNumber,
      description: row.description,
      chapter: row.chapter,
      indent: Number(row.indent) || 0,
      score: Number(row.score) || 0,
    }));
  }

  private async searchByKeyword(
    query: string,
    limit: number,
    expandedTokens?: string[],
  ): Promise<KeywordCandidate[]> {
    // Check if query is HTS code or description search
    const isHtsCodeQuery = this.isLikelyHtsCodeQuery(query);

    if (isHtsCodeQuery) {
      return this.searchByCode(query, limit);
    }

    return this.searchByFullText(query, limit, expandedTokens);
  }

  /**
   * Search by HTS code pattern matching
   */
  private async searchByCode(
    query: string,
    limit: number,
  ): Promise<KeywordCandidate[]> {
    const normalizedCode = query.replace(/[^\d]/g, '');
    const containsQuery = `%${query}%`;
    const prefixQuery = `${query}%`;
    const normalizedPrefix = `${normalizedCode}%`;
    const normalizedContains = `%${normalizedCode}%`;

    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect(
        `CASE
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') = :normalizedCode THEN 1.0
          WHEN hts.htsNumber ILIKE :prefixQuery THEN 0.95
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') LIKE :normalizedPrefix THEN 0.93
          WHEN hts.htsNumber ILIKE :containsQuery THEN 0.5
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') LIKE :normalizedContains THEN 0.45
          ELSE 0
        END`,
        'score',
      )
      .where('hts.isActive = :active', { active: true })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
      .andWhere("hts.chapter NOT IN ('98', '99')")

      .andWhere(
        new Brackets((qb) => {
          qb.where('hts.htsNumber ILIKE :containsQuery', { containsQuery });
          if (normalizedCode) {
            qb.orWhere(
              "REPLACE(hts.htsNumber, '.', '') LIKE :normalizedContains",
              {
                normalizedContains,
              },
            );
          }
        }),
      )
      .setParameters({
        normalizedCode,
        prefixQuery,
        normalizedPrefix,
        containsQuery,
        normalizedContains,
      })
      .orderBy('score', 'DESC')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => ({
      htsNumber: row.htsNumber,
      score: Number(row.score) || 0,
    }));
  }

  /**
   * Search by full-text search with ranking.
   * Strategy:
   *  1. Try AND of all words (most precise).
   *  2. Fallback: OR of all words — ts_rank_cd scores by how many words match,
   *     preserving multi-word context over single-word degeneration.
   */
  private async searchByFullText(
    query: string,
    limit: number,
    expandedTokens?: string[],
  ): Promise<KeywordCandidate[]> {
    const words =
      expandedTokens && expandedTokens.length > 0
        ? expandedTokens
        : this.expandQueryTokens(this.tokenizeQuery(query));
    if (words.length === 0) return [];

    const runQuery = async (
      tsquery: string,
    ): Promise<KeywordCandidate[]> => {
      const rows = await this.htsRepository
        .createQueryBuilder('hts')
        .select('hts.htsNumber', 'htsNumber')
        .addSelect(
          `ts_rank_cd(hts.searchVector, to_tsquery('english', :tsquery))`,
          'score',
        )
        .where('hts.isActive = :active', { active: true })
        .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
        .andWhere("hts.chapter NOT IN ('98', '99')")
        .andWhere(`hts.searchVector @@ to_tsquery('english', :tsquery)`)
        .setParameters({ tsquery })
        .orderBy('score', 'DESC')
        .addOrderBy('hts.htsNumber', 'ASC')
        .limit(limit)
        .getRawMany();
      return rows.map((row) => ({
        htsNumber: row.htsNumber,
        score: Number(row.score) || 0,
      }));
    };

    const results = new Map<string, KeywordCandidate>();
    const andQuery = this.buildTsQuery(words, '&');
    const orQuery = this.buildTsQuery(words, '|');

    if (andQuery) {
      try {
        const rows = await runQuery(andQuery);
        for (const row of rows) {
          results.set(row.htsNumber, row);
        }
      } catch {
        // ignore invalid tsquery
      }
    }

    if (orQuery) {
      try {
        const rows = await runQuery(orQuery);
        for (const row of rows) {
          const existing = results.get(row.htsNumber);
          if (!existing || row.score > existing.score) {
            results.set(row.htsNumber, row);
          }
        }
      } catch {
        // ignore invalid tsquery
      }
    }

    return [...results.values()]
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      )
      .slice(0, limit);
  }

  async findByHtsNumber(htsNumber: string): Promise<HtsEntity | null> {
    return this.htsRepository.findOne({
      where: { htsNumber, isActive: true },
      select: [
        'htsNumber', 'chapter', 'heading', 'subheading', 'statisticalSuffix',
        'indent', 'description', 'parentHtsNumber', 'parentHtses', 'fullDescription',
        'hasChildren', 'isActive', 'unitOfQuantity',
        'general', 'generalRate', 'rateFormula', 'rateVariables',
        'other', 'otherRate', 'otherRateFormula', 'otherRateVariables',
        'specialRates', 'chapter99', 'chapter99Links', 'chapter99ApplicableCountries',
        'adjustedFormula', 'adjustedFormulaVariables',
        'effectiveDate', 'expirationDate', 'sourceVersion', 'importDate',
        'confirmed', 'requiredReview', 'requiredReviewComment',
        'metadata', 'createdAt', 'updatedAt',
      ],
    });
  }

  private normalizeQuery(query: string): string {
    // Strip combining diacritical marks so accented characters tokenize correctly
    // e.g. "Pokémon" → "Pokemon", "Björk" → "Bjork"
    const deaccented = (query ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const normalized = deaccented.trim().replace(/\s+/g, ' ');
    return normalized
      .replace(/\btransfomer\b/gi, 'transformer')
      .replace(/\btranformer\b/gi, 'transformer')
      .replace(/\bcomic[\s-]?books?\b/gi, 'comic book')
      .replace(/\bt[\s-]?shirts?\b/gi, 'tshirt')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private clampLimit(limit: number, fallback: number): number {
    if (!Number.isFinite(limit)) {
      return fallback;
    }
    return Math.max(1, Math.min(this.MAX_LIMIT, Math.floor(limit)));
  }

  private isLikelyHtsCodeQuery(query: string): boolean {
    const normalized = query.replace(/\s+/g, '');
    return (
      /^[\d.]+$/.test(normalized) ||
      /^\d{2,4}(\.\d{0,2}){0,3}$/.test(normalized)
    );
  }

  private classifyQueryIntent(query: string): QueryIntent {
    const compact = query.replace(/\s+/g, '');
    if (this.isLikelyHtsCodeQuery(compact)) {
      return 'code';
    }

    const hasAlpha = /[a-z]/i.test(query);
    const hasDigit = /\d/.test(query);
    if (hasAlpha && hasDigit) {
      return 'mixed';
    }
    return 'text';
  }

  private tokenizeQuery(query: string): string[] {
    const raw = (query || '').toLowerCase().match(/[a-z0-9]+/g) || [];
    const stopWords = new Set([
      'a',
      'an',
      'the',
      'for',
      'and',
      'with',
      'to',
      'of',
      'in',
      'on',
      'by',
      'or',
      'at',
      'from',
    ]);

    const corrected = raw.map((token) => {
      if (token === 'transfomer' || token === 'tranformer') {
        return 'transformer';
      }
      return token;
    });

    return [
      ...new Set(
        corrected.filter((token) => token.length > 1 && !stopWords.has(token)),
      ),
    ];
  }

  // Expansion is intentionally non-recursive (single-depth only) to avoid infinite loops
  // and unbounded expansion. e.g. bluetooth→wireless, but wireless's synonyms are NOT
  // further expanded. This is a design constraint, not an oversight.
  private expandQueryTokens(tokens: string[]): string[] {
    const expanded = new Set<string>();
    for (const token of tokens) {
      expanded.add(token);
      for (const synonym of this.QUERY_SYNONYMS[token] || []) {
        expanded.add(synonym);
      }
    }
    return [...expanded];
  }

  private sanitizeTsToken(token: string): string {
    return token.replace(/[^a-zA-Z0-9]/g, '');
  }

  private buildTsQuery(tokens: string[], operator: '&' | '|'): string {
    const safeTokens = tokens
      .map((token) => this.sanitizeTsToken(token))
      .filter((token) => token.length > 0);
    if (safeTokens.length === 0) {
      return '';
    }

    return safeTokens.map((token) => `${token}:*`).join(` ${operator} `);
  }

  private buildEntryText(entry: CandidateEntry): string {
    const hierarchy = (entry.fullDescription || []).join(' ');
    return `${entry.description || ''} ${hierarchy}`.trim().toLowerCase();
  }

  private buildEntryTokenSet(entry: CandidateEntry): Set<string> {
    const text = this.buildEntryText(entry);
    return new Set(text.match(/[a-z0-9]+/g) || []);
  }

  private computeCoverageScore(tokens: string[], text: string): number {
    if (tokens.length === 0 || !text) {
      return 0;
    }

    let covered = 0;
    for (const token of tokens) {
      if (token.length < 2) {
        continue;
      }
      if (text.includes(token)) {
        covered += 1;
      }
    }

    return covered / tokens.length;
  }

  private computePhraseBoost(query: string, text: string): number {
    const needle = query.trim().toLowerCase();
    if (!needle || needle.length < 4) {
      return 0;
    }

    return text.includes(needle) ? 0.2 : 0;
  }

  private computeSpecificityBoost(htsNumber: string): number {
    // Reward more specific (longer) HTS codes so that 10-digit leaf entries
    // outrank ambiguous 4-digit headings when both surface in the same search.
    const digits = htsNumber.replace(/\./g, '').length;
    if (digits >= 10) return 0.12;
    if (digits >= 8) return 0.08;
    if (digits >= 6) return 0.04;
    return 0;
  }

  private computeGenericPenalty(description: string, coverage: number): number {
    const normalized = (description || '').trim().toLowerCase();
    const isGeneric =
      this.GENERIC_LABELS.has(normalized) || normalized.startsWith('other');
    if (!isGeneric) {
      return 0;
    }

    return coverage >= 0.66 ? 0.05 : 0.28;
  }

  private rrf(rankIndex: number): number {
    return 1 / (this.RRF_K + rankIndex + 1);
  }

  /**
   * Inject 10-digit leaf HTS codes matching `prefix` into the fused candidate map
   * with a synthetic RRF score (as if they ranked at `syntheticRank`).
   * Only injects entries not already in the map (existing entries keep their higher scores).
   * Used to ensure intent-boosted entries always appear in the scoring pass even when
   * they don't rank in the top-N of semantic or lexical search.
   */
  private async injectCandidates(
    fused: Map<string, number>,
    prefix: string,
    syntheticRank: number,
  ): Promise<void> {
    // Allow 8-digit leaf codes only when the inject prefix itself is 8+ digits
    // (e.g., 9101.99.80 is a valid 8-digit leaf). For shorter prefixes, only
    // inject 10-digit leaf codes to avoid injecting intermediate parent nodes.
    const prefixDigits = prefix.replace(/\./g, '').length;
    const lenCondition =
      prefixDigits >= 8
        ? "LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (8, 10)"
        : "LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10";

    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .where('hts.isActive = :active', { active: true })
      .andWhere('hts.htsNumber LIKE :prefix', { prefix: `${prefix}%` })
      .andWhere(lenCondition)
      .andWhere("hts.chapter NOT IN ('98', '99')")
      .getRawMany<{ htsNumber: string }>();

    const syntheticScore = this.rrf(syntheticRank);
    for (const { htsNumber } of rows) {
      if (!fused.has(htsNumber)) {
        fused.set(htsNumber, syntheticScore);
      }
    }
  }

  private applyChapterDiversity<T extends { chapter?: string }>(
    rows: T[],
    limit: number,
    enabled: boolean,
  ): T[] {
    if (!enabled || rows.length <= limit) {
      return rows;
    }

    const perChapterCap = 3;
    const counts = new Map<string, number>();
    const selected: T[] = [];
    const deferred: T[] = [];

    for (const row of rows) {
      const chapter = row.chapter || 'unknown';
      const current = counts.get(chapter) || 0;
      if (current < perChapterCap) {
        selected.push(row);
        counts.set(chapter, current + 1);
      } else {
        deferred.push(row);
      }
    }

    const merged = [...selected, ...deferred];
    return merged.slice(0, limit);
  }

  // ── Declarative intent engine ─────────────────────────────────────────────

  /**
   * Replaces buildLexicalTokens().
   * Removes tokens listed in any matched rule's lexicalFilter.stripTokens.
   */
  private applyLexicalFiltering(tokens: string[], rules: IntentRule[]): string[] {
    if (rules.length === 0) return tokens;
    const stripSet = new Set<string>();
    for (const rule of rules) {
      for (const t of rule.lexicalFilter?.stripTokens ?? []) {
        stripSet.add(t);
      }
    }
    if (stripSet.size === 0) return tokens;
    const filtered = tokens.filter((t) => !stripSet.has(t));
    return filtered.length > 0 ? filtered : tokens;
  }

  /**
   * Replaces the 3 hard-coded injectCandidates() calls.
   * Injects all HTS prefixes listed in matched rules' inject specs.
   */
  private async injectRuleCandidates(
    fused: Map<string, number>,
    rules: IntentRule[],
  ): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const rule of rules) {
      for (const spec of rule.inject ?? []) {
        promises.push(this.injectCandidates(fused, spec.prefix, spec.syntheticRank ?? 40));
      }
    }
    await Promise.all(promises);
  }

  /**
   * Replaces the 6 ad-hoc `if (signals.hasX && ...) return null` blocks.
   * Returns false when the entry should be excluded from results.
   *
   * @param matchedRuleIds - Set of rule IDs that fired (used for inter-rule exceptions).
   */
  private applyRuleWhitelist(
    entry: CandidateEntry,
    entryTokens: Set<string>,
    rules: IntentRule[],
    matchedRuleIds: Set<string>,
  ): boolean {
    // Positive allow-checks (allowChapters / allowPrefixes) use OR logic across rules:
    // the entry must satisfy AT LEAST ONE matched rule's positive filter.
    // This prevents zero results when two rules have conflicting allowChapters —
    // e.g. "costume jewelry necklace" matches HALLOWEEN_COSTUME_INTENT[ch.95] AND
    // JEWELRY_NECKLACE_INTENT[ch.71]; with AND logic every entry was rejected.
    const rulesWithAllow = rules.filter(
      (r) =>
        r.whitelist &&
        ((r.whitelist.allowChapters?.length ?? 0) > 0 ||
          (r.whitelist.allowPrefixes?.length ?? 0) > 0),
    );

    if (rulesWithAllow.length > 0) {
      const passesAny = rulesWithAllow.some((rule) => {
        const ws = rule.whitelist!;
        if (ws.allowChapters?.length && !ws.allowChapters.includes(entry.chapter)) return false;
        if (ws.allowPrefixes?.length && !ws.allowPrefixes.some((p) => entry.htsNumber.startsWith(p))) return false;
        return true;
      });
      if (!passesAny) return false;
    }

    // Deny-checks keep AND logic: any matched rule can still reject an entry.
    for (const rule of rules) {
      const ws = rule.whitelist;
      if (!ws) continue;

      // denyPrefixes: entry.htsNumber MUST NOT start with any of these
      if (ws.denyPrefixes) {
        for (const p of ws.denyPrefixes) {
          if (entry.htsNumber.startsWith(p)) return false;
        }
      }

      // denyChapters: entry.chapter MUST NOT be any of these
      // Exception: MANUFACTURING_INTENT lifts COMIC_INTENT's ch.84 denial
      if (ws.denyChapters) {
        for (const ch of ws.denyChapters) {
          if (entry.chapter === ch) {
            if (rule.id === 'COMIC_INTENT' && ch === '84' && matchedRuleIds.has('MANUFACTURING_INTENT')) {
              continue; // MANUFACTURING_INTENT lifts the ch.84 ban
            }
            return false;
          }
        }
      }

      // denyChaptersIfEntryHasTokens: deny ch.X if entry text contains any of these tokens
      if (ws.denyChaptersIfEntryHasTokens) {
        for (const spec of ws.denyChaptersIfEntryHasTokens) {
          if (entry.chapter === spec.chapter && spec.tokens.some((t) => entryTokens.has(t))) {
            return false;
          }
        }
      }

      // denyChapterUnlessEntryHasTokens: deny ch.X UNLESS entry text has any of these tokens
      if (ws.denyChapterUnlessEntryHasTokens) {
        for (const spec of ws.denyChapterUnlessEntryHasTokens) {
          if (entry.chapter === spec.chapter && !spec.tokens.some((t) => entryTokens.has(t))) {
            return false;
          }
        }
      }

      // denyNonAllowedUnlessEntryHasTokens: deny entries not in allowedChapters unless
      // entry text has fallback tokens (e.g. media vocab for COMIC_INTENT)
      if (ws.denyNonAllowedUnlessEntryHasTokens) {
        const { allowedChapters, tokens } = ws.denyNonAllowedUnlessEntryHasTokens;
        if (!allowedChapters.includes(entry.chapter) && !tokens.some((t) => entryTokens.has(t))) {
          return false;
        }
      }
    }

    return true; // entry passes all whitelist checks
  }

  /** Replaces computeIntentBoost(). */
  private computeRuleBoost(
    entry: CandidateEntry,
    entryTokens: Set<string>,
    rules: IntentRule[],
  ): number {
    let boost = 0;
    for (const rule of rules) {
      for (const adj of rule.boosts ?? []) {
        if (this.scoreAdjustmentMatches(adj, entry, entryTokens)) {
          boost += adj.delta;
        }
      }
    }
    return boost;
  }

  /** Replaces computeIntentPenalty(). */
  private computeRulePenalty(
    entry: CandidateEntry,
    entryTokens: Set<string>,
    rules: IntentRule[],
  ): number {
    let penalty = 0;
    for (const rule of rules) {
      for (const adj of rule.penalties ?? []) {
        if (this.scoreAdjustmentMatches(adj, entry, entryTokens)) {
          penalty += adj.delta;
        }
      }
    }
    return penalty;
  }

  private scoreAdjustmentMatches(
    adj: ScoreAdjustment,
    entry: CandidateEntry,
    entryTokens: Set<string>,
  ): boolean {
    if (adj.prefixMatch && !entry.htsNumber.startsWith(adj.prefixMatch)) return false;
    if (adj.chapterMatch && entry.chapter !== adj.chapterMatch) return false;
    if (adj.denyPrefixMatch && entry.htsNumber.startsWith(adj.denyPrefixMatch)) return false;
    if (adj.skipIfChapter && entry.chapter === adj.skipIfChapter) return false;
    if (adj.entryMustHaveAnyToken?.length && !adj.entryMustHaveAnyToken.some((t) => entryTokens.has(t))) return false;
    if (adj.skipIfEntryHasAnyToken?.length && adj.skipIfEntryHasAnyToken.some((t) => entryTokens.has(t))) return false;
    return true;
  }

  // ── End declarative intent engine ─────────────────────────────────────────


  private combineResults(
    semantic: SemanticCandidate[],
    keyword: KeywordCandidate[],
    limit: number,
  ): Array<{ htsNumber: string; score: number }> {
    const combined = new Map<
      string,
      {
        htsNumber: string;
        score: number;
        inSemantic: boolean;
        inKeyword: boolean;
      }
    >();

    semantic.forEach((result, index) => {
      combined.set(result.htsNumber, {
        htsNumber: result.htsNumber,
        score: this.rrf(index),
        inSemantic: true,
        inKeyword: false,
      });
    });

    keyword.forEach((result, index) => {
      const existing = combined.get(result.htsNumber);
      if (existing) {
        existing.score += this.rrf(index);
        existing.inKeyword = true;
      } else {
        combined.set(result.htsNumber, {
          htsNumber: result.htsNumber,
          score: this.rrf(index),
          inSemantic: false,
          inKeyword: true,
        });
      }
    });

    return Array.from(combined.values())
      .map((row) => ({
        htsNumber: row.htsNumber,
        score: row.score + (row.inKeyword && row.inSemantic ? 0.06 : 0),
      }))
      .sort((a, b) => {
        if (b.score === a.score) {
          return a.htsNumber.localeCompare(b.htsNumber);
        }
        return b.score - a.score;
      })
      .slice(0, limit);
  }
}
