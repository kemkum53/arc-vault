# ARC Vault — Dashboard UI Kit

A hi-fi single-page recreation of the planned **ARC Vault dashboard** (Next.js 14 + App Router + Tailwind + shadcn/ui in production). Built as a click-through prototype using React + Babel and styled from the shared design tokens at `../../colors_and_type.css`.

## What's included

| File | Role |
|---|---|
| `index.html` | Entry — loads React, Lucide icons, fonts. Single-page app shell. |
| `App.jsx` | Router + top-level state (active screen, account-linked flag). |
| `Sidebar.jsx` | Fixed left rail — brand lockup, nav, account status footer. |
| `Topbar.jsx` | Top chrome — screen title, search, sync button, account chip. |
| `ConnectScreen.jsx` | Login / Embark-link screen (the user's first surface). |
| `DashboardScreen.jsx` | Stat overview — credits, slots, sync status, recent items, quests in progress. |
| `InventoryScreen.jsx` | Grid of inventory item tiles + filters. |
| `QuestsScreen.jsx` | Quest list grouped by trader, with objective progress. |
| `HideoutScreen.jsx` | 9 hideout modules with level upgrades & requirements. |
| `ProjectsScreen.jsx` | Active projects with phase progress + goal counts. |
| `shared.jsx` | Buttons, Chip, StatCard, ItemTile, ProgressBar, Icon helpers. |
| `mockData.js` | Mock items, quests, modules, projects sourced from `GAME_DATA_REFERENCE.md`. |

## Behavior

- Sidebar nav switches between screens with no real routing — feels like a SPA.
- The first time the kit opens you land on the **Connect** screen. Click "Connect Embark" to seed the account and land on the dashboard. Hit "Hesabı Kaldır" in Settings to reset.
- The dashboard's "Senkronize Et" button kicks off a 3-second animated sync — the brand-gradient sweep bar runs across the header during the operation.
- All numbers and item ids are mock — they match the shape of the real arctracker API for legibility.

## Tokens

Color, type, spacing, motion are all from `../../colors_and_type.css`. No new tokens introduced here.
