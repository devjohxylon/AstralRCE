/**
 * Items that exist on PC Rust but not (or not as kit shortnames) on Rust Console Edition.
 * Kit Builder uses this denylist on top of rust-items.json.
 */
export const PC_ONLY_ITEM_IDS = new Set([
  // High-zoom scopes — Console does not have 8x / 16x / variable zoom
  "weapon.mod.8x.scope",
  "weapon.mod.small.scope",

  // Newer PC-only attachments (keep out even if added to JSON later)
  "weapon.mod.extendedmags",
  "weapon.mod.burstmodule",
  "weapon.mod.gascompressionoverdrive",
  "weapon.mod.oilfiltersilencer",
  "weapon.mod.sodacansilencer",
  "weapon.mod.militarysilencer",
  "weapon.mod.targetting",
  "weapon.mod.flashlight.uv",

  // PC-only / not spawnable kit junk
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

  // Character customization (not kit items)
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

  // Costumes / NPC suits not used in normal RCE kits
  "barrelcostume",
  "cratecostume",
  "scientistsuit_heavy",
  "hazmatsuit_scientist",
  "hazmatsuit_scientist_peacekeeper",

  // Recent PC siege content not on Console
  "ballista.static",
  "ballista.mounted",
  "catapult",
  "batteringram",
  "siegetower",
  "homingmissile.launcher",
  "ammo.rocket.homing",
  "hmlmg",
]);

/** Name patterns that are PC-only even if shortname differs */
export const PC_ONLY_NAME_RE =
  /\b(16x|8x zoom|variable zoom|garry'?s mod|toolgun|homing missile|battering ram|siege tower|ballista|catapult)\b/i;

export function isConsoleKitItem(item) {
  if (!item?.id) return false;
  if (PC_ONLY_ITEM_IDS.has(item.id)) return false;
  if (PC_ONLY_NAME_RE.test(item.name || "") || PC_ONLY_NAME_RE.test(item.id)) return false;
  if (/hairstyle|facialhair|armpithair|eyebrow\.style|pubichair/i.test(item.id)) return false;
  return true;
}
