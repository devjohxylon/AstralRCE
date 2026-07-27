/**
 * Filter Kit Builder to year-round Rust Console Edition items.
 * Drops PC-only shortnames, event/seasonal cosmetics, and Fun junk.
 */

export const BLOCKED_ITEM_IDS = new Set([
  // High-zoom scopes — not on Console
  "weapon.mod.8x.scope",
  "weapon.mod.small.scope",

  // Newer PC-only attachments
  "weapon.mod.extendedmags",
  "weapon.mod.burstmodule",
  "weapon.mod.gascompressionoverdrive",
  "weapon.mod.oilfiltersilencer",
  "weapon.mod.sodacansilencer",
  "weapon.mod.militarysilencer",
  "weapon.mod.targetting",
  "weapon.mod.flashlight.uv",

  // PC-only / admin junk
  "toolgun",
  "blueprintbase",
  "blood",
  "door.key",
  "note",
  "map",
  "habrepair",
  "minihelicopter.repair",
  "scraptransportheli.repair",
  "ammo.rocket.smoke",
  "bleach", // PC farming chemical — Console uses fertilizer/composter

  // Character customization
  "femalearmpithair.style01",
  "femaleeyebrow.style01",
  "female_hairstyle_01",
  "female_hairstyle_02",
  "female_hairstyle_03",
  "female_hairstyle_05",
  "femalepubichair.style01",
  "malearmpithair.style01",
  "maleeyebrow.style01",
  "facialhair.style01",
  "male.facialhair.style02",
  "male.facialhair.style03",
  "male.facialhair.style04",
  "male_hairstyle_01",
  "male_hairstyle_02",
  "male_hairstyle_03",
  "male_hairstyle_04",
  "male_hairstyle_05",
  "malepubichair.style01",

  // NPC / costume suits
  "barrelcostume",
  "cratecostume",
  "scientistsuit_heavy",
  "hazmatsuit_scientist",
  "hazmatsuit_scientist_peacekeeper",

  // PC siege
  "ballista.static",
  "ballista.mounted",
  "catapult",
  "batteringram",
  "siegetower",
  "homingmissile.launcher",
  "ammo.rocket.homing",
  "hmlmg",

  // Easter (event-only on Console)
  "attire.bunnyears",
  "attire.bunny.onesie",
  "easter.bronzeegg",
  "easter.silveregg",
  "easter.goldegg",
  "easter.paintedeggs",
  "easterbasket",
  "easterdoorwreath",

  // Halloween (event-only)
  "halloween.mummysuit",
  "halloween.surgeonsuit",
  "halloween.candy",
  "halloween.lootbag.small",
  "halloween.lootbag.medium",
  "halloween.lootbag.large",
  "scarecrow",
  "scarecrow.suit",
  "scarecrowhead",
  "gloweyes",
  "clatter.helmet",
  "cursedcauldron",
  "fogmachine",
  "spookyspeaker",
  "spiderweb",
  "gravestone",
  "wall.graveyard.fence",
  "woodcross",
  "coffin.storage",
  "pumpkinbasket",
  "jackolantern.angry",
  "jackolantern.happy",
  "largecandles",
  "smallcandles",
  "strobelight",

  // Christmas (event-only)
  "santahat",
  "attire.reindeer.headband",
  "candycane",
  "candycaneclub",
  "xmasdoorwreath",
  "xmas.lightstring",
  "xmas.tree",
  "xmas.door.garland",
  "xmas.window.garland",
  "xmas.decoration.baubels",
  "xmas.decoration.gingerbreadmen",
  "xmas.decoration.pinecone",
  "xmas.decoration.candycanes",
  "xmas.decoration.tinsel",
  "xmas.decoration.star",
  "xmas.decoration.lights",
  "xmas.present.small",
  "xmas.present.medium",
  "xmas.present.large",
  "stocking.small",
  "stocking.large",
  "snowman",
  "snowmachine",
  "snowball",
  "giantcandycanedecor",
  "giantlollipops",
  "pookie.bear",

  // Limited / novelty not for normal kits
  "hat.dragonmask",
  "partyhat",
  "arcade.machine.chippy",
  "rustige_egg_a",
  "rustige_egg_b",
  "drumkit",
  "piano",
  "xylophone",
  "chineselantern",
]);

const BLOCKED_ID_RE =
  /^(xmas\.|easter\.|halloween\.|attire\.bunny|stocking\.|snowman|snowball|snowmachine|santahat|candycane|scarecrow|gloweyes|clatter\.|fogmachine|spooky|spiderweb|gravestone|woodcross|coffin\.|pumpkinbasket|jackolantern|rustige_egg|arcade\.|drumkit|piano|xylophone)/i;

const BLOCKED_NAME_RE =
  /\b(16x|8x zoom|variable zoom|garry'?s mod|toolgun|bunny|easter|halloween|christmas|xmas|santa|snowman|snowball|scarecrow|mummy|surgeon scrub|reindeer|candy cane|loot bag|present|stocking|gingerbread|baubel|tinsel|wreath|homing missile|battering ram|siege tower|ballista|catapult|bleach|pookie|chippy|xylophone|fogger)\b/i;

export function isConsoleKitItem(item) {
  if (!item?.id) return false;
  if (item.category === "Fun") return false;
  if (BLOCKED_ITEM_IDS.has(item.id)) return false;
  if (BLOCKED_ID_RE.test(item.id)) return false;
  if (BLOCKED_NAME_RE.test(item.name || "") || BLOCKED_NAME_RE.test(item.id)) return false;
  if (/hairstyle|facialhair|armpithair|eyebrow\.style|pubichair|costume/i.test(item.id)) return false;
  return true;
}

// Back-compat aliases
export const PC_ONLY_ITEM_IDS = BLOCKED_ITEM_IDS;
export const PC_ONLY_NAME_RE = BLOCKED_NAME_RE;
