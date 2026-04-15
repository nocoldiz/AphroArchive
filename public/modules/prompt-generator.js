// ================================================
// Stable Diffusion XL Prompt Composer Algorithm
// ================================================
// This is a complete, ready-to-run Node.js script that loads your wildcards
// (from .txt files, one phrase per line) and intelligently composes varied,
// high-quality SDXL prompts.
//
// It uses a structured composition system:
//   - Base quality + subject + appearance + clothing (2 pieces) + pose + background + effects + style
//   - Extra random wildcards for diversity
//   - Automatically injects the MOST USEFUL LoRAs (characterlora, clothlora, facelora) with random strength
//
// How to use:
// 1. Put all your wildcard files (skin.txt, base_prompt.txt, characterlora.txt, etc.) in a folder called "wildcards"
// 2. Run with: node sdxl-prompt-composer.js
// 3. It will generate 10 example prompts (change the number in generateSDXLPrompts(10))

const fs = require('fs');
const path = require('path');

const WILDCARD_DIR = './wildcards'; // ← Change this to your actual folder path

// All wildcard names you provided (exact match to your .txt filenames)
const wildcardNames = [
  "skin", "spng", "spngtpls", "straddle", "sus", "sustpls", "blwjb", "blwjbtpls",
  "char list1", "cwg", "dgy", "dgyfet", "flnlsn", "flnlsntpls", "Dpthrt", "DpthrtSV",
  "frmbhd", "ftjb", "hndjb", "job", "lglft", "lgsup", "lkfrntfrmbhd", "miss", "missFt",
  "Pldrvr", "Pldrvrtpls", "rvscwg", "rvscwgft", "rvssus", "rvssustpls", "rvsupstrdle",
  "rvsupstrdletpls", "alchemy_equipment", "alchemy_settings", "armor_clothes",
  "assassin_eras", "background_abstract_generic", "background_elements_nature",
  "background_generic", "background_nature", "blood_magic_effects", "body_markings",
  "character", "character_f", "character_m", "clothing_diversity", "color",
  "creatures_familiars", "cultist_settings", "deity_domains", "divination_tools",
  "effects_action", "elemental_types", "expressions", "ffpc-booru", "footwear",
  "fortune_teller_settings", "gem_tags", "headwear_fantasy", "hogwarts_locations",
  "hogwarts_spells", "injury", "knight_weapon_poses", "looking_tags", "magic_book",
  "magic_clothes", "magic_neckwear", "magic_tags", "merchant_wares", "nautical",
  "occult_elements", "pirate_settings", "pose_standing_generic", "priest_traditions",
  "rogue_hideouts", "shields", "spellcaster_gestures", "starwars_locations",
  "summoned_creatures", "superhero_themes", "tech_gear", "throne_room_elements",
  "view_tags", "viking_settings", "weapons_melee", "weapons_ranged", "weather_time",
  "witch_settings", "workshop_elements", "base_negative_prompt", "base_prompt",
  "breast_sizes", "characters", "chokers", "clothes", "colors", "eyes", "female",
  "full_outfits", "hair", "hair_lengths", "hair_ornaments", "hair_styles", "legwear",
  "necklaces", "neckwear", "no_sad", "secondary_legwear", "amzn", "amzntpls", "Nrsing",
  "upstrdle", "upstrdletpls", "Actors", "Actress", "Adjective", "Aesthetics", "Age",
  "Age-Play", "Alien", "Ambience", "Anger", "Animal-Crossing", "Animal-Play", "Anime",
  "Appliances", "Aquatic", "Armor", "Artifacts", "Art-Quality-Styles", "Art-Styling",
  "Avian", "Background", "Bags", "Basic", "Basic-Type", "Bear", "Belt", "Black", "Blue",
  "Blurry", "Body-Piercing", "Body-Type", "Bondage", "Bondage-Positions", "Bone",
  "Bottomwear", "Boudoir", "Bovine", "Bra-Color", "Bra-Patterns", "Bra-Type", "Breasts",
  "Breasts-Prefix", "Breasts-Size", "Breasts-Type", "Brown", "Buildings-and-Rooms",
  "Business-Woman", "Cartoons", "Cat", "Celebrity", "Ceramic", "Characters-With-Accessories",
  "Chibi", "Chubby", "Cloth", "Clothing-Removal", "Composition", "Concept", "Corsets",
  "Costumes", "Country-City", "Cow", "Creature", "Crystal", "Cum-Play", "Deer",
  "Desserts", "Digimon", "Digital", "Dinosaur", "Disaster", "Dog", "Dragon",
  "Dragon-Feral", "Dress", "Drinks", "Ears", "Eevee", "Emoji", "Environment", "Equine",
  "Events", "Exhibitionism", "Exposed-Arms", "Exposed-Breasts", "Exposed-Chest",
  "Exposed-Lower-Torso", "Eyebrows", "Eye-Shape", "Eyewear", "Face-Shape", "Facial",
  "Fantasy", "Fantasy-Landscape", "Female-Hourglass", "Fetish-Gear", "Fictional",
  "Fineart", "Fine-Art-Female", "Fit", "Flowers", "Fluffy", "FNAF", "Food", "Fossil",
  "Fox", "Franchise-Girls", "Fur", "Furries", "Furry", "Game-Consoles", "Games",
  "Gender", "Gender-All", "Gender-Play", "Genital-Piercing-Female",
  "Genital-Piercing-Male", "Gestures", "Glamour-Shots", "Glass", "Goat", "Green", "Grey",
  "Group-Sex", "Happy", "Hardcore", "Hardlight", "Headwear", "Heavy", "Heritage-Sites",
  "Historical-Characters", "Hobby-Female", "Horns", "Humanoid", "Insect", "Instruments",
  "Jewelry-Accessories", "League-of-Legends", "Leather", "Length", "Light", "Lighting",
  "Line-Art", "Lingerie", "Lingerie-Female", "Lion", "Looking", "LOTR-Characters",
  "LOTR-Landscape", "Lust", "Magenta", "Male", "Male-Muscular", "Manga", "Medieval-Female",
  "Medium", "Metal", "Mineral", "Misc", "Misc-Appendages", "Misc-Clothing",
  "Misc-Emotions", "Misc-Head", "Misc-Lower-Torso", "Misc-Styles", "Misc-Subjects",
  "Misc-Upper-Torso", "MLP", "Monkey", "Monochrome", "Monster", "Movies", "Mutilation",
  "Nano", "Nationality-Race", "Nipple-Type", "Normal", "Nose-Shape", "Noun",
  "Occupation-Female", "Occupations", "Orange", "Outfits", "Painting", "Palettes",
  "Panty-Action", "Panty-Pattern", "Panty-Type", "Parks-and-Monuments",
  "Penetration-and-Insertions", "Penis-Prefix", "Penis-State", "Penis-Type", "Pink",
  "Planets-and-Space", "Plastic", "Pokemon", "Pokemon-All", "Poor-Condition",
  "Portrait-Female", "Postures-and-Poses", "POV", "Preposition", "Pupil-Color",
  "Pupil-Shape", "Purple", "Pussy-Prefix", "Pussy-Type", "Quality-Modifiers", "Rabbit",
  "Red", "Resin", "Robes", "Robot", "Rock", "Rodent", "RPG-Avatars", "RPG-Female",
  "Sadness", "Same-Sex", "Scalie", "Scenarios", "Sci-Fi", "Scifi-Female", "Sclera-Color",
  "Seasons", "Sex-Positions", "Sex-Toys", "Sexy", "Shape", "Short", "Simple", "Size",
  "Slug", "Smother", "Special", "Special-Ex", "Sports", "Stimulation", "Stripper",
  "Suits", "Super-Hero", "Super-Villain", "Surprise", "Surreal", "Surreal-Landscape",
  "Swimwear", "Swimwear-Female", "Swimwear-Male", "Swimwear-State", "Synthetic", "Tall",
  "Tattoos", "Taur", "Texture", "Tiger", "Top", "Topwear", "Utensils", "Vectors",
  "Vehicles", "Verb", "Viewpoint", "Watersports", "Weapons", "Weather", "White", "Wolf",
  "Wood", "XXX", "Yellow", "Yoshi", "fantasyprompts", "fantasyhairstyles",
  "charactertype", "headgear", "accessories", "characterlora", "clothcolor", "clothlora",
  "clothmaterial", "clothstyle", "dressmod", "facelora", "hairbangstyle", "haircolor",
  "hairmainstyle", "hairsubstyle", "hairtexture", "shoecolor", "shoes", "shoesheel",
  "shoesmod", "skirt", "skirtmod", "stocking", "stockingcolor", "stockingmod", "topmod",
  "uniform", "fashionable2", "fashionable1", "advanced-post-apocalyptic-locations",
  "advanced-post-apocalyptic-weapons", "advanced-post-apocalyptic-outfits",
  "advanced-post-apocalyptic-accessories", "advanced-artist-photographer",
  "t-shirt, lowleg_shorts3", "t-shirt, lowleg_shorts2", "t-shirt, lowleg_shorts1",
  "korean girl3", "korean girl2", "korean girl1",
  "collared_shirt and flared_skirt as material3",
  "collared_shirt and flared_skirt as material2",
  "collared_shirt and flared_skirt as material1",
  "frilled_shirt and long_skirt3", "frilled_shirt and long_skirt2",
  "frilled_shirt and long_skirt1", "aran sweater3", "aran sweater2", "aran sweater1",
  "underwear620y", "underwear520y", "underwear420y", "blouse styles3", "blouse styles2",
  "blouse styles1", "sundress3", "sundress2", "sundress1", "golfwaer3", "golfwaer2",
  "golfwaer1", "two-piece styles4", "two-piece styles3", "two-piece styles2",
  "two-piece styles1", "coat styles3", "coat styles2", "coat styles1", "t-shirt styles3",
  "t-shirt styles2", "t-shirt styles1", "one-piece styles3", "one-piece styles1",
  "one-piece styles2", "stewardess outfit styles4", "stewardess outfit styles3",
  "stewardess outfit styles2", "stewardess outfit styles1", "underwear3", "underwear2",
  "underwear1", "bikini style3", "bikini style2", "bikini style1", "overfit style3",
  "overfit style2", "overfit style1", "dress3", "dress2", "dress1", "wedding dress3",
  "wedding dress2", "wedding dress1", "jacket style3", "jacket style2", "jacket style1",
  "knit_style3", "knit_style2", "knit_style1", "cardigan_style3", "cardigan_style2",
  "cardigan_style1", "traning_look3", "traning_look2", "traning_look1", "luxauly look4",
  "luxauly look3", "luxauly look2", "luxauly look", "koreanlook3", "koreanlook2",
  "koreanlook", "vacation look2", "vacation look", "golflook2", "golflook", "dayilylook",
  "Casual outfit2", "Casual outfit", "luxioryfashion", "wedding guest fashion3",
  "wedding guest fashion2", "wedding guest fashion", "chanel_image", "adventuring_gear",
  "merge.sh", "merged_civitai_entries", "AgeNumber", "fantasysetting"
];

// Load all wildcards from .txt files
function loadWildcards() {
  const loaded = {};
  for (const name of wildcardNames) {
    const filePath = path.join(WILDCARD_DIR, `${name}.txt`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      loaded[name] = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      console.log(`✅ Loaded wildcard: ${name} (${loaded[name].length} entries)`);
    } else {
      console.warn(`⚠️  Wildcard not found: ${filePath} (using empty array)`);
      loaded[name] = [];
    }
  }
  return loaded;
}

// Helper: get random item from a wildcard
function getRandomFromWildcard(wildcards, category) {
  const list = wildcards[category];
  if (!list || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

// Helper: pick random category from a list
function getRandomCategory(categories) {
  if (!categories || categories.length === 0) return null;
  return categories[Math.floor(Math.random() * categories.length)];
}

// Structured sections for intelligent composition (you can tweak these)
const sectionCategories = {
  quality: ["base_prompt", "Art-Quality-Styles", "Quality-Modifiers", "Art-Styling"],
  subject: ["character", "character_f", "character_m", "charactertype", "Actors", "Actress", "RPG-Female", "RPG-Avatars", "Fantasy", "Fictional", "Creature", "Monster", "Dragon", "Pokemon", "Furries", "Furry"],
  appearance: ["skin", "hair", "hair_styles", "hair_lengths", "hair_ornaments", "hairmainstyle", "hairsubstyle", "hairtexture", "haircolor", "hairbangstyle", "eyes", "breast_sizes", "Body-Type", "Face-Shape", "Breasts", "Breasts-Size", "Breasts-Type", "Nationality-Race", "Age", "AgeNumber"],
  clothing: ["clothes", "full_outfits", "armor_clothes", "magic_clothes", "clothing_diversity", "clothcolor", "clothmaterial", "clothstyle", "dressmod", "skirt", "skirtmod", "stocking", "stockingmod", "topmod", "uniform", "fashionable1", "fashionable2", "headgear", "accessories", "footwear", "shoes", "shoesmod", "legwear", "secondary_legwear", "chokers", "necklaces", "neckwear", "magic_neckwear", "lingerie", "swimwear", "costumes", "outfits", "Dress", "Topwear", "Bottomwear", "Lingerie-Female", "Swimwear-Female"],
  pose: ["pose_standing_generic", "expressions", "looking_tags", "knight_weapon_poses", "spellcaster_gestures", "Postures-and-Poses", "Gestures", "Sex-Positions", "Bondage-Positions", "POV", "Viewpoint"],
  background: ["background_generic", "background_nature", "background_abstract_generic", "background_elements_nature", "Fantasy-Landscape", "LOTR-Landscape", "Surreal-Landscape", "hogwarts_locations", "starwars_locations", "throne_room_elements", "rogue_hideouts", "workshop_elements", "Environment", "Buildings-and-Rooms"],
  effects: ["effects_action", "magic_tags", "blood_magic_effects", "weather_time", "elemental_types", "Lighting", "Ambience", "Weather", "Seasons", "injury", "body_markings"],
  style: ["fantasyprompts", "fantasyhairstyles", "fantasysetting", "superhero_themes", "Sci-Fi", "Anime", "Manga", "Fineart", "Digital", "Painting", "Line-Art", "Surreal"]
};

// Main prompt generator
function generateSDXLPrompts(wildcards, count = 10) {
  const prompts = [];

  for (let i = 0; i < count; i++) {
    const positiveParts = [];

    // 1. Quality (always first)
    const qualityCat = getRandomCategory(sectionCategories.quality);
    const quality = getRandomFromWildcard(wildcards, qualityCat);
    if (quality) positiveParts.push(quality);

    // 2. Subject
    const subjectCat = getRandomCategory(sectionCategories.subject);
    const subject = getRandomFromWildcard(wildcards, subjectCat);
    if (subject) positiveParts.push(subject);

    // 3. Appearance
    const appearanceCat = getRandomCategory(sectionCategories.appearance);
    const appearance = getRandomFromWildcard(wildcards, appearanceCat);
    if (appearance) positiveParts.push(appearance);

    // 4. Clothing (2 random pieces for richness)
    const clothingParts = [];
    for (let k = 0; k < 2; k++) {
      const clothingCat = getRandomCategory(sectionCategories.clothing);
      const clothing = getRandomFromWildcard(wildcards, clothingCat);
      if (clothing) clothingParts.push(clothing);
    }
    if (clothingParts.length > 0) positiveParts.push(`wearing ${clothingParts.join(', ')}`);

    // 5. Pose / Action
    const poseCat = getRandomCategory(sectionCategories.pose);
    const pose = getRandomFromWildcard(wildcards, poseCat);
    if (pose) positiveParts.push(pose);

    // 6. Background
    const bgCat = getRandomCategory(sectionCategories.background);
    const bg = getRandomFromWildcard(wildcards, bgCat);
    if (bg) positiveParts.push(`in ${bg}`);

    // 7. Effects / Lighting
    const effectCat = getRandomCategory(sectionCategories.effects);
    const effect = getRandomFromWildcard(wildcards, effectCat);
    if (effect) positiveParts.push(effect);

    // 8. Artistic style
    const styleCat = getRandomCategory(sectionCategories.style);
    const style = getRandomFromWildcard(wildcards, styleCat);
    if (style) positiveParts.push(style);

    // 9. Extra random wildcards for maximum variety (1-3 more)
    const usedCategories = Object.values(sectionCategories).flat();
    const extraCats = Object.keys(wildcards).filter(cat => !usedCategories.includes(cat));
    const numExtra = Math.floor(Math.random() * 3) + 1;
    for (let k = 0; k < numExtra; k++) {
      if (extraCats.length === 0) break;
      const extraCat = getRandomCategory(extraCats);
      const extra = getRandomFromWildcard(wildcards, extraCat);
      if (extra) positiveParts.push(extra);
      // remove used to avoid duplicates in one prompt
      extraCats.splice(extraCats.indexOf(extraCat), 1);
    }

    let positive = positiveParts.filter(p => p).join(', ');

    // 10. MOST USEFUL LoRAs (characterlora + clothlora + facelora)
    let loraString = '';
    const loraCategories = ["characterlora", "clothlora", "facelora"];
    const numLoras = Math.random() < 0.3 ? 1 : 2; // 70% chance of 2 LoRAs
    for (let j = 0; j < numLoras && loraCategories.length > 0; j++) {
      const loraCat = loraCategories[Math.floor(Math.random() * loraCategories.length)];
      const loraName = getRandomFromWildcard(wildcards, loraCat);
      if (loraName) {
        const strength = (0.7 + Math.random() * 0.6).toFixed(1); // 0.7–1.3 range (SDXL sweet spot)
        loraString += ` <lora:${loraName}:${strength}>`;
      }
      // remove used category so we don't repeat the same LoRA type
      loraCategories.splice(loraCategories.indexOf(loraCat), 1);
    }
    positive += loraString;

    // Negative prompt (always solid)
    let negative = getRandomFromWildcard(wildcards, 'base_negative_prompt') || 'low quality, worst quality, blurry, deformed, ugly, text, watermark';
    const noSad = getRandomFromWildcard(wildcards, 'no_sad');
    if (noSad) negative += `, ${noSad}`;

    prompts.push({
      positive: positive.trim(),
      negative: negative.trim()
    });
  }

  return prompts;
}

// ======================
// RUN THE ALGORITHM
// ======================
const wildcards = loadWildcards();
const generatedPrompts = generateSDXLPrompts(wildcards, 10); // change 10 to any number you want

console.log('\n🎨 Generated 10 Stable Diffusion XL Prompts:\n');
generatedPrompts.forEach((p, index) => {
  console.log(`Prompt ${index + 1}:`);
  console.log(`   Positive → ${p.positive}`);
  console.log(`   Negative → ${p.negative}`);
  console.log('─'.repeat(80));
});

// Optional: save to JSON for easy import into Automatic1111 / ComfyUI / Forge
fs.writeFileSync('sdxl-prompts.json', JSON.stringify(generatedPrompts, null, 2));
console.log('\n✅ All prompts saved to sdxl-prompts.json');