process.env.DISCORD_TOKEN = "x";
process.env.DISCORD_CLIENT_ID = "1";
process.env.VIP_CLAIM_PHRASE = "i need stone|i need stones";

const { isVipClaimPhrase, normalizeQuickChat } = await import(
  "../src/modules/rcon/vip-sync.js"
);

const cases = [
  ["d11_quick_chat_i_need_phrase_format stones", true, "RCE stone QC"],
  ["d11_quick_chat_i_need_phrase_format d11_Water", false, "RCE water (not default phrase)"],
  ["I need stone", true, "human stone"],
  ["I need stones", true, "human stones"],
  ["I need water", false, "human water not in default"],
  ["d11_quick_chat_i_need_phrase_format d11_Wood", false, "wood"],
];

console.log(
  "normalize stone token:",
  normalizeQuickChat("d11_quick_chat_i_need_phrase_format stones"),
);

let failed = 0;
for (const [msg, expected, label] of cases) {
  const got = isVipClaimPhrase(msg);
  const ok = got === expected;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(msg)} → ${got} (expected ${expected})`,
  );
}

// Water phrase mode
process.env.VIP_CLAIM_PHRASE = "i need water";
// config already loaded — mutate live config
const { config } = await import("../src/config.js");
config.vip.claimPhrase = "i need water";
const waterOk = isVipClaimPhrase("d11_quick_chat_i_need_phrase_format d11_Water");
console.log(`${waterOk ? "✓" : "✗"} RCE water with water phrase → ${waterOk}`);
if (!waterOk) failed += 1;

process.exit(failed ? 1 : 0);
