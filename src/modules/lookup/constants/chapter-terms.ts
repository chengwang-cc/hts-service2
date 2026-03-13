/**
 * Per-chapter vocabulary map for consumer-language query detection.
 *
 * Each chapter entry has:
 *   - name: short human-readable chapter title
 *   - strongTokens: single tokens that unambiguously indicate this chapter
 *     (used by detectChapterIntent — any ONE token fires the chapter match)
 *   - consumerTerms: multi-word phrases for documentation / synonym expansion
 *     (not used in runtime matching)
 *
 * Used by detectChapterIntent() in intent-rules.ts to produce weak chapter
 * boosts that coexist with Phase 1 strong rules.
 *
 * Phase 3 will audit and prune tokens that introduce noise.
 */

export interface ChapterTermEntry {
  /** Short chapter title (for documentation). */
  name: string;
  /**
   * Tokens that individually, unambiguously indicate this chapter.
   * Prefer rare, distinctive tokens over generic ones to avoid false positives.
   * Example: 'lipstick' is unambiguous for ch.33; 'cream' is NOT (could be food).
   */
  strongTokens: string[];
  /** Consumer phrases for documentation and synonym expansion (Phase 3). */
  consumerTerms: string[];
}

export const CHAPTER_TERMS: Readonly<Record<string, ChapterTermEntry>> = {
  '01': {
    name: 'Live animals',
    strongTokens: ['livestock', 'bovine', 'equine', 'swine', 'poultry', 'hatching'],
    consumerTerms: ['live cattle', 'live horses', 'live pigs', 'live chickens'],
  },
  '02': {
    name: 'Meat',
    strongTokens: ['beef', 'pork', 'veal', 'venison', 'offal', 'carcass', 'carcasses'],
    consumerTerms: ['beef steak', 'pork chops', 'ground beef', 'chicken breast', 'lamb chops'],
  },
  '03': {
    name: 'Fish and seafood',
    strongTokens: ['salmon', 'tuna', 'shrimp', 'prawns', 'lobster', 'crab', 'tilapia', 'cod', 'halibut', 'sardines', 'anchovies', 'oysters', 'mussels', 'scallops', 'squid', 'octopus', 'catfish', 'herring', 'mackerel', 'trout', 'snapper'],
    consumerTerms: ['fresh salmon', 'frozen shrimp', 'canned tuna', 'fish fillet', 'smoked salmon', 'lobster tail', 'crab legs'],
  },
  '04': {
    name: 'Dairy and eggs',
    strongTokens: ['butter', 'cheese', 'yogurt', 'whey', 'lactose', 'casein', 'kefir'],
    consumerTerms: ['butter', 'cheddar cheese', 'skim milk powder', 'yogurt', 'cream cheese', 'eggs', 'heavy cream'],
  },
  '07': {
    name: 'Vegetables',
    strongTokens: ['broccoli', 'cauliflower', 'spinach', 'asparagus', 'artichoke', 'zucchini', 'eggplant', 'brussels', 'leek', 'leeks'],
    consumerTerms: ['frozen broccoli', 'dried mushrooms', 'canned tomatoes', 'fresh garlic', 'baby carrots'],
  },
  '08': {
    name: 'Fruits and nuts',
    strongTokens: ['mango', 'mangoes', 'avocado', 'avocados', 'lychee', 'papaya', 'durian', 'rambutan', 'guava', 'kiwi', 'pomegranate', 'persimmon', 'fig', 'figs', 'dates', 'almonds', 'cashews', 'pistachios', 'macadamia', 'pecans'],
    consumerTerms: ['fresh mango', 'dried dates', 'frozen strawberries', 'fresh avocado', 'roasted almonds'],
  },
  '09': {
    name: 'Coffee, tea, spices',
    strongTokens: ['coffee', 'espresso', 'cinnamon', 'turmeric', 'cardamom', 'cumin', 'coriander', 'vanilla', 'cloves', 'nutmeg', 'saffron', 'paprika', 'anise', 'ginger'],
    consumerTerms: ['coffee beans', 'green tea', 'black pepper', 'cinnamon sticks', 'ground turmeric'],
  },
  '10': {
    name: 'Cereals',
    strongTokens: ['wheat', 'barley', 'rye', 'oats', 'oat', 'buckwheat', 'millet', 'sorghum', 'quinoa', 'triticale'],
    consumerTerms: ['wheat flour', 'rolled oats', 'brown rice', 'barley grains'],
  },
  '15': {
    name: 'Fats and oils',
    strongTokens: ['lard', 'tallow', 'suet', 'shortening', 'margarine', 'ghee'],
    consumerTerms: ['olive oil', 'coconut oil', 'palm oil', 'butter oil', 'margarine'],
  },
  '16': {
    name: 'Preparations of meat and fish',
    strongTokens: ['chorizo', 'salami', 'prosciutto', 'pepperoni', 'anchovy'],
    consumerTerms: ['canned tuna', 'canned salmon', 'canned sardines', 'canned chicken', 'meat sauce'],
  },
  '17': {
    name: 'Sugar and confectionery',
    strongTokens: ['molasses', 'treacle', 'fondant', 'sucrose', 'fructose', 'dextrose', 'maltose'],
    consumerTerms: ['raw cane sugar', 'honey', 'maple syrup', 'powdered sugar', 'candy'],
  },
  '18': {
    name: 'Cocoa and chocolate',
    strongTokens: ['cocoa', 'cacao', 'chocolate', 'ganache', 'praline', 'nougat'],
    consumerTerms: ['cocoa powder', 'dark chocolate bar', 'milk chocolate', 'white chocolate'],
  },
  '19': {
    name: 'Bakery and cereal products',
    strongTokens: ['pasta', 'noodles', 'spaghetti', 'lasagna', 'macaroni', 'vermicelli', 'crackers', 'wafer', 'wafers', 'cracker', 'pretzel', 'pretzels', 'biscuit', 'biscuits'],
    consumerTerms: ['pasta', 'instant noodles', 'crackers', 'cookies', 'bread crumbs', 'cereal bars'],
  },
  '20': {
    name: 'Preserved fruits and vegetables',
    strongTokens: ['pickles', 'pickle', 'chutney', 'salsa', 'hummus', 'tahini', 'pesto', 'kimchi'],
    consumerTerms: ['canned tomatoes', 'dill pickles', 'strawberry jam', 'apple sauce', 'tomato paste'],
  },
  '21': {
    name: 'Miscellaneous food preparations',
    strongTokens: ['ketchup', 'mayonnaise', 'mustard', 'worcestershire', 'sriracha', 'tabasco', 'miso'],
    consumerTerms: ['soy sauce', 'ketchup', 'mayonnaise', 'hot sauce', 'chicken broth'],
  },
  '22': {
    name: 'Beverages',
    strongTokens: ['beer', 'wine', 'whiskey', 'whisky', 'vodka', 'rum', 'tequila', 'bourbon', 'brandy', 'gin', 'champagne', 'cider', 'lager', 'ale'],
    consumerTerms: ['beer', 'red wine', 'whiskey', 'sparkling water', 'orange juice', 'energy drink'],
  },
  '23': {
    name: 'Animal feed',
    strongTokens: ['kibble', 'pellets', 'silage', 'fishmeal', 'feather'],
    consumerTerms: ['dog food', 'cat food', 'bird seed', 'fish food', 'pet treats'],
  },
  '30': {
    name: 'Pharmaceutical products',
    strongTokens: ['pharmaceutical', 'antibiotic', 'insulin', 'vaccine', 'capsule', 'capsules', 'suppository', 'ibuprofen', 'acetaminophen', 'aspirin', 'bandage', 'bandages'],
    consumerTerms: ['vitamin supplements', 'aspirin tablets', 'first aid bandages', 'ibuprofen', 'blood pressure medicine'],
  },
  '33': {
    name: 'Cosmetics and perfumes',
    strongTokens: ['lipstick', 'mascara', 'eyeshadow', 'blush', 'concealer', 'foundation', 'moisturizer', 'serum', 'toner', 'primer', 'highlighter', 'bronzer', 'eyeliner', 'cologne', 'deodorant', 'antiperspirant', 'hairspray', 'conditioner', 'sunscreen', 'sunblock'],
    consumerTerms: ['lipstick', 'mascara', 'perfume', 'moisturizer', 'shampoo', 'foundation', 'sunscreen SPF', 'facial serum'],
  },
  '34': {
    name: 'Soaps and detergents',
    // Note: 'dishwasher' removed (ambiguous — machine=ch.84, tablets=ch.34; 'toothbrush' removed to ch.96 only)
    strongTokens: ['detergent', 'mouthwash', 'floss', 'bleach', 'laundry', 'castile'],
    consumerTerms: ['bar soap', 'dish soap', 'laundry detergent', 'toothpaste', 'hand wash', 'fabric softener'],
  },
  '38': {
    name: 'Miscellaneous chemical products',
    strongTokens: ['insecticide', 'pesticide', 'herbicide', 'fungicide', 'disinfectant', 'adhesive', 'sealant', 'lubricant', 'antifreeze'],
    consumerTerms: ['bug spray', 'weed killer', 'super glue', 'wd-40', 'car antifreeze'],
  },
  '39': {
    name: 'Plastics',
    strongTokens: ['acrylic', 'polyethylene', 'polypropylene', 'polystyrene', 'pvc', 'nylon', 'plexiglass'],
    consumerTerms: ['plastic storage container', 'food container', 'plastic cutting board', 'garbage bags', 'bubble wrap'],
  },
  '40': {
    name: 'Rubber',
    strongTokens: ['latex', 'vulcanized', 'nitrile', 'neoprene', 'silicone'],
    consumerTerms: ['rubber gloves', 'latex gloves', 'rubber band', 'silicone baking mat', 'door mat'],
  },
  '42': {
    name: 'Leather goods and bags',
    strongTokens: ['luggage', 'suitcase', 'briefcase', 'handbag', 'purse', 'clutch', 'duffel', 'satchel', 'rucksack', 'travelcase'],
    consumerTerms: ['leather wallet', 'leather belt', 'handbag', 'backpack', 'rolling luggage', 'laptop bag'],
  },
  '44': {
    name: 'Wood and wood articles',
    strongTokens: ['plywood', 'particleboard', 'chipboard', 'fiberboard', 'hardwood', 'softwood', 'teak', 'mahogany', 'bamboo', 'timber', 'lumber', 'veneer'],
    consumerTerms: ['plywood sheet', 'bamboo cutting board', 'wooden picture frame', 'pine lumber', 'hardwood flooring'],
  },
  '48': {
    name: 'Paper and paperboard',
    strongTokens: ['cardboard', 'paperboard', 'corrugated', 'newsprint', 'stationery'],
    consumerTerms: ['copy paper', 'cardboard box', 'tissue paper', 'paper napkins', 'paper towels'],
  },
  '49': {
    name: 'Printed matter',
    strongTokens: ['comic', 'comics', 'manga', 'novel', 'novels', 'paperback', 'hardcover', 'textbook', 'textbooks', 'periodical', 'periodicals'],
    consumerTerms: ['comic book', 'manga volume', 'paperback novel', 'magazine', 'newspaper'],
  },
  '52': {
    name: 'Cotton',
    strongTokens: ['denim', 'muslin', 'flannel', 'chambray', 'canvas', 'twill', 'poplin', 'seersucker', 'percale'],
    consumerTerms: ['cotton fabric', 'denim fabric', 'cotton yarn', 'cotton flannel', 'canvas fabric'],
  },
  '57': {
    name: 'Carpets and rugs',
    strongTokens: ['carpet', 'carpets', 'rug', 'rugs', 'doormat', 'doormats', 'tufted'],
    consumerTerms: ['area rug', 'carpet tile', 'doormat', 'bathroom mat', 'runner rug'],
  },
  '61': {
    name: 'Knitted apparel',
    strongTokens: ['hoodie', 'legging', 'leggings', 'sweatshirt', 'sweatshirts', 'hosiery', 'turtleneck', 'cardigan', 'knitwear'],
    consumerTerms: ['cotton t-shirt', 'hoodie', 'yoga pants', 'compression socks', 'athletic underwear'],
  },
  '62': {
    name: 'Woven apparel',
    strongTokens: ['jeans', 'khakis', 'chinos', 'blazer', 'windbreaker', 'parka', 'trench'],
    consumerTerms: ['dress shirt', 'jeans', 'cargo pants', 'windbreaker jacket', 'blazer'],
  },
  '63': {
    name: 'Home textiles',
    strongTokens: ['bedsheet', 'duvet', 'comforter', 'pillowcase', 'pillowcases', 'tablecloth', 'curtain', 'curtains', 'drape', 'drapes', 'quilt', 'towel', 'towels'],
    consumerTerms: ['bed sheets', 'bath towel', 'blanket', 'pillow case', 'shower curtain'],
  },
  '64': {
    name: 'Footwear',
    strongTokens: ['sneaker', 'sneakers', 'boots', 'sandal', 'sandals', 'loafer', 'loafers', 'stiletto', 'stilettos', 'moccasin', 'moccasins', 'slipper', 'slippers', 'clogs', 'espadrille', 'espadrilles'],
    consumerTerms: ['running shoes', 'leather boots', 'flip flops', 'high heels', 'hiking boots', 'sandals'],
  },
  '65': {
    name: 'Headgear',
    strongTokens: ['beanie', 'beret', 'fedora', 'balaclava', 'visor', 'bonnet', 'stetson'],
    consumerTerms: ['baseball cap', 'winter hat', 'sun hat', 'beanie', 'helmet'],
  },
  '69': {
    name: 'Ceramic articles',
    strongTokens: ['porcelain', 'earthenware', 'stoneware', 'terracotta', 'faience'],
    consumerTerms: ['ceramic coffee mug', 'dinner plate', 'ceramic tile', 'porcelain bowl', 'ceramic vase'],
  },
  '70': {
    name: 'Glass',
    strongTokens: ['glassware', 'borosilicate', 'tempered', 'pyrex'],
    consumerTerms: ['glass wine glass', 'glass jar', 'glass mirror', 'glass bowl', 'glass vase'],
  },
  '71': {
    name: 'Jewelry and precious metals',
    strongTokens: ['necklace', 'bracelet', 'earring', 'earrings', 'pendant', 'brooch', 'locket', 'anklet', 'cufflink', 'cufflinks', 'tiara', 'gemstone', 'gemstones', 'sapphire', 'emerald', 'ruby', 'topaz', 'tourmaline'],
    consumerTerms: ['gold ring', 'silver necklace', 'diamond earrings', 'fashion bracelet', 'pearl necklace', 'charm bracelet'],
  },
  '73': {
    name: 'Iron and steel articles',
    strongTokens: ['cookware', 'skillet', 'wok', 'cast', 'stainless', 'galvanized', 'tinplate'],
    consumerTerms: ['cast iron skillet', 'stainless steel pan', 'steel shelf', 'wire basket', 'metal bucket'],
  },
  '74': {
    name: 'Copper',
    strongTokens: ['copper', 'brass', 'bronze'],
    consumerTerms: ['copper pipe', 'brass fittings', 'copper wire', 'bronze statue'],
  },
  '76': {
    name: 'Aluminum',
    strongTokens: ['aluminum', 'aluminium'],
    consumerTerms: ['aluminum foil', 'aluminum can', 'aluminum ladder', 'aluminum sheet'],
  },
  '82': {
    name: 'Tools',
    // Note: 'jigsaw' removed (ambiguous — power tool=ch.82, puzzle=ch.95); 'router' removed (ambiguous — woodworking=ch.82, network=ch.85)
    strongTokens: ['screwdriver', 'wrench', 'pliers', 'chisel', 'hacksaw', 'bandsaw', 'grinder'],
    consumerTerms: ['screwdriver set', 'hammer', 'adjustable wrench', 'drill bits', 'circular saw blade'],
  },
  '83': {
    name: 'Miscellaneous hardware',
    strongTokens: ['padlock', 'deadbolt', 'hinge', 'hinges', 'hasp', 'clasp'],
    consumerTerms: ['padlock', 'door hinge', 'door handle', 'drawer pull', 'coat hook'],
  },
  '84': {
    name: 'Machinery and appliances',
    strongTokens: ['refrigerator', 'dishwasher', 'microwave', 'dehumidifier', 'humidifier', 'compressor', 'turbine', 'piston', 'extruder', 'centrifuge'],
    consumerTerms: ['washing machine', 'refrigerator', 'microwave oven', 'coffee maker', 'vacuum cleaner', 'air conditioner', 'dishwasher'],
  },
  '85': {
    name: 'Electrical and electronic equipment',
    strongTokens: ['smartphone', 'laptop', 'router', 'modem', 'transformer', 'transistor', 'diode', 'capacitor', 'resistor', 'semiconductor', 'photodiode', 'smartwatch', 'airpod'],
    consumerTerms: ['smartphone', 'laptop computer', 'LED bulb', 'bluetooth speaker', 'USB charger', 'HDMI cable', 'wireless earbuds', 'smart TV'],
  },
  '87': {
    name: 'Vehicles and parts',
    strongTokens: ['automobile', 'motorcycle', 'bicycle', 'scooter', 'moped', 'axle', 'bumper', 'fender', 'carburetor', 'alternator', 'radiator', 'windshield'],
    consumerTerms: ['car battery', 'bicycle', 'motorcycle helmet', 'car floor mats', 'windshield wipers'],
  },
  '90': {
    name: 'Optical and precision instruments',
    strongTokens: ['binoculars', 'telescope', 'microscope', 'stethoscope', 'spectrometer', 'oscilloscope', 'syringe', 'thermometer', 'barometer', 'hydrometer'],
    consumerTerms: ['sunglasses', 'reading glasses', 'digital thermometer', 'camera lens', 'bathroom scale'],
  },
  '91': {
    name: 'Clocks and watches',
    strongTokens: ['wristwatch', 'chronograph', 'timepiece', 'escapement', 'horology'],
    consumerTerms: ['wristwatch', 'alarm clock', 'wall clock', 'quartz watch', 'pocket watch'],
  },
  '92': {
    name: 'Musical instruments',
    strongTokens: ['guitar', 'violin', 'cello', 'piano', 'keyboard', 'saxophone', 'trumpet', 'flute', 'clarinet', 'oboe', 'bassoon', 'trombone', 'tuba', 'banjo', 'mandolin', 'ukulele', 'harp', 'accordion', 'harmonica', 'drum', 'drums', 'cymbal'],
    consumerTerms: ['acoustic guitar', 'electric keyboard', 'drum set', 'violin bow', 'guitar strings'],
  },
  '94': {
    name: 'Furniture and lighting',
    strongTokens: ['sofa', 'couch', 'mattress', 'bookshelf', 'bookcase', 'dresser', 'armchair', 'recliner', 'loveseat', 'ottoman', 'nightstand', 'wardrobe', 'armoire', 'credenza', 'chandelier'],
    consumerTerms: ['office chair', 'dining table', 'bookshelf', 'sofa', 'mattress', 'floor lamp', 'desk lamp'],
  },
  '95': {
    name: 'Toys, games and sports',
    strongTokens: ['lego', 'playmobil', 'barbie', 'nerf', 'puzzle', 'jigsaw', 'playstation', 'xbox', 'nintendo', 'gameboy', 'trampoline'],
    consumerTerms: ['building blocks', 'board game', 'action figure', 'plush toy', 'video game console', 'basketball', 'yoga mat'],
  },
  '96': {
    name: 'Miscellaneous manufactured articles',
    // Note: 'toothbrush' moved here only (removed from ch.34 — toothbrush the article is ch.96, not ch.34 soaps)
    strongTokens: ['ballpoint', 'biro', 'zipper', 'zippers', 'umbrella', 'umbrellas', 'comb', 'razor', 'razors', 'hairbrush', 'toothbrush'],
    consumerTerms: ['ballpoint pen', 'mechanical pencil', 'umbrella', 'hairbrush', 'nail clippers', 'zipper'],
  },
};
