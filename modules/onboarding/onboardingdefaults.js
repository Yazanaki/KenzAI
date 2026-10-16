// modules/onboarding/onboardingdefaults.js
// Static defaults for the application onboarding flow.
// These are intentionally NOT configurable via command (per design) — only the
// channel tours are. Values mirror what was previously hardcoded in
// modules/applications/application.js so behaviour stays consistent.

// Brand black, matching the application/empire embeds.
const EMBED_COLOR = "#000000";

// Yazanaki Empire Constitution (Google Doc).
const CONSTITUTION_URL =
  "https://docs.google.com/document/d/1rDxBfjuo2fkrK_LGpmce3vEPy-ImDIDZ-FFJwhDE6mE/edit";

// Main Yazanaki Empire discord invite.
const YAZANAKI_INVITE_URL = "https://discord.gg/yazanaki-1220847061797179524";

// The key KenzAI commands every new member should know. Rendered on the
// "commands" onboarding step.
const TAUGHT_COMMANDS = [
  { command: "/member view", description: "Look up any member's Empire profile, rank and stats." },
  { command: "/points balance", description: "Check how many Yazanaki points you've earned." },
  { command: "/points checkin", description: "Claim your daily points — do this every day!" },
  { command: "/link main <username>", description: "Link your Minecraft account to your Discord." },
  { command: "/profile", description: "View and equip cosmetics you own (badges, capes, pets)." },
  { command: "/shop", description: "Spend your points on badges, capes and other cosmetics." },
];

module.exports = {
  EMBED_COLOR,
  CONSTITUTION_URL,
  YAZANAKI_INVITE_URL,
  TAUGHT_COMMANDS,
};
