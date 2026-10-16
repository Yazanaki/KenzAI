# KenzAI Discord Bot — User Guide

Welcome! This README is for **Discord users and staff** who want to know what commands exist, what they do, and when to use them.

---

## Quick Start

1. Type `/` in Discord to open slash commands.
2. Pick a command from this bot (for example `/application`, `/member view`, `/points balance`).
3. Fill command options if needed.
4. For interactive commands, use the buttons/select menus the bot shows.

---

# Citizen Commands

## 🏛️ Empire Info

### `/yazanaki`
Shows Yazanaki Empire summary information (leadership + population stats).

**Use it for:** a quick public overview of the empire.

---

## 🧑 Member Management

### `/member view`
- View a member profile by Discord user or Minecraft username.
- Works for non Yazanaki members

---

## 🏰 Clan Commands

### `/clan view`
- View a Yazanki Clan by abbreviation or full name, or use the command without name/abbreviation in the specific clan discord.
- Use this command to see Minecraft-specific stats for the clans.

### `/clan list`
- Lists all clans with invite link and member count.

---

## 💎 Points Economy

### `/points balance`
- View your points balance.

### `/points shop`
- Open the points shop menu.
- Shows which tasks earn you how many points.
  - Recruiting a member: `5 Points`
  - Every 5mil given to leadership: `30 Points`
  - Killing a non Yazanaki player wearing max neth armor: `100 Points`
  - Building a money making farm: `150 Points`

### `/points checkin`
- Claim daily and weekly points.
- Claim 2 points per day.
- Claim 10 points per week.

### `/points invite`
- Get your personal clan discord invite links.
  - Display your amount of people invited per clan.
  - Earn `5 points` per invite.

---

## 🎮 Server Stats

### ~~`/server`~~
Shows supported game servers and buttons for server/team/player stats.

**Use it for:** viewing in-game server data (for configured servers).

---

# Council Commands

## 🆔 Empire ID System

### `/empireid reserve`
Reserve a YZNK ID number.

### `/empireid update`
Update who an ID belongs to (Discord and/or Minecraft).

### ~~`/empireid view`~~
View details for one Empire ID.

### ~~`/empireid lookup`~~
Find a user's Empire ID by Discord or Minecraft identity.

### `/empireid list`
List IDs (can be filtered).

### `/empireid stats`
Show ID system statistics.

**Use it for:** ID assignment and record keeping.

---

## 🎖️ Draft System

### `/draft view`
View one member's draft status.

### `/draft list`
List active drafts.

### `/draft cancel`
Cancel a draft and promote to Citizen.

### `/draft complete`
Force-complete a draft (with outcome).

### `/draft stats`
Show draft system totals.

### `/draft config`
Show current draft timing/settings.

### `/draft toggle-testing`
Switch testing mode on/off (short test durations).

**Use it for:** managing draft progress, reminders, and completion.

---

## 🧑 Member Management

### `/member kick`
Kick a member from Yazanaki Empire (reapply cooldown applies).

### `/member ban`
Permanently ban a member from Yazanaki clans.

**Use it for:** member moderation and lookups.

---

## 🏰 Clan Commands

### `/clan add`
Create/register a new clan.

### `/clan edit`
Edit clan info (name, abbreviation, roles, flag, server, mode).

### `/clan remove`
Delete a clan entry.

### `/clan sync-residents`
One-time sync of resident counts from member records.

**Use it for:** clan setup and maintenance.

---

## ⚖️ Judiciary / Court

### `/court ...`
Main legal workflow command with grouped subcommands (case lifecycle):

- **case**: create/view/list/assign/dismiss
- **investigation**: add findings, verify findings, complete investigation
- **verdict**: propose/finalize verdict decisions
- **signoff**: approval/rejection and status tracking
- **enforcement**: execute/verify/close/pardon

**Use it for:** structured judicial case handling.

> Note: Many court actions are restricted to specific judiciary roles.

---

## 🔗 Account Linking

### `/link username:<minecraft_name>`
Link your Discord account to your Minecraft username.

**Use it for:** identity sync across bot systems.

### ~~`/autolink-test ...` (staff/debug)~~
Troubleshooting command set for checking/forcing/bulk autolink.

**Use it for:** diagnosing link issues (typically admins/staff only).

---

## 💎 Points Economy

### `/points add` (admin)
Grant points manually.

**Use it for:** rewards, progression, and engagement perks.

---

## 🧩 Roles Configuration

### `/roles add`
Add current guild to role detection config.

### `/roles update`
Refresh role detection from Discord.

### `/roles remove`
Remove a guild from role detection.

### `/roles list`
List configured guilds.

### `/roles view`
View this guild's role config.

### `/roles categorize`
Set a role as rank/status category.

**Use it for:** maintaining role mapping and detection behavior.
---

## 🎮 Yazanaki Client API (hosted in KenzAI)

KenzAI also serves the API the Yazanaki Client launcher and its in-game mod
talk to (`modules/launcherApi/`): EmpireID sign-in with DM codes, client
cosmetics for every player, and the mod's member list. It uses KenzAI's MySQL
database, so `MYSQL_ENABLED=true` with the members, clans and EmpireID tables
filled (dual-write or MySQL reads) is required. Its tables are created on
startup.

It listens on `LAUNCHER_API_PORT`, or on the panel's own port (`SERVER_PORT`)
when that isn't set. The launcher's API address is then this server's address,
e.g. `http://<server ip>:<port>`, or better a panel subdomain or reverse proxy
with HTTPS pointing at that port (set `TRUST_PROXY=1` behind the proxy).

`.env` options: `LAUNCHER_API_PORT`, `LAUNCHER_API_HOST` (default `0.0.0.0`),
`TRUST_PROXY`, `OG_CAPE_CLOSED=1` (stop granting the OG cape).

The routes in `modules/launcherApi/api/` are a copy of
[YazanakiAPI](https://github.com/Yazanaki/YazanakiAPI); change them there and
copy them over with its `scripts/sync-to-kenzai.sh`.
