# Forged: online transaction fraud redesign (v0.2)

**Status:** the computer side is built in the prototype with a scripted Gus: `prototype/orders.js` (content, row builder, scripted Gus) and `prototype/game.js` (ticket, toolkit, campaign strip). What changed from v0.1 while building it is marked *(built)*.

**Goal:** keep Forged the same fun office game, but make every round produce rows in the **IEEE-CIS Fraud Detection** format (Kaggle / Vesta), so the detector we train on that dataset can learn from players' new schemes.

**Decided with the team lead:**
- Dataset: IEEE-CIS.
- The 3D office, the boss, heat, Gus and the walk to the IN tray all stay. Only the in-game computer changes: it becomes an online-fraud desktop.
- Players get freedom through three things: free choices on the order, a toolkit they combine, and multi-step campaigns.
- It must not turn into filling in forms. The learning curve stays as short as it is today.
- Legit (non-fraud) rows come from the real dataset.

## 1. What stays the same

The round loop doesn't change. Only the paper on the desk changes.

| Today (invoice fraud) | After (online fraud) |
| --- | --- |
| Read the memo and case file, pick one of 4 schemes | Read the memo and the target shop's profile, pick one of 4 starter schemes (or a blank kit) |
| A paper invoice on screen | An **order ticket** on screen: a checkout summary in 5 boxes |
| 6 tools, hotkeys 1–6, drag onto the paper | A 6-item **toolkit**, same hotkeys, drag onto the ticket |
| 2 edits minimum, a capped edit budget | Same: each toolkit drop costs one edit |
| Cover note to Brenda the clerk | Same, as the "note to customer support" (P/R email text stays game-only) |
| Print → carry the envelope → Gus's IN tray | Print the order slip → carry it → Gus, now the shop's **risk engine**, reviews it in the booth |
| Verdict, payout, Gus learns your trick, version bump | Same. "Flagged" now reads as **declined / chargeback**. |

D's 3D work is only reskinning: the printed slip, the booth close-up labels, posters and the TV text.

## 2. The order ticket: 5 boxes, never a blank form

Every box starts filled in by the scheme's starter kit. *(built)* Card, email, device and IP belong to the persona and apply to every order in the campaign; address, item and time are per order. The item is free to change; every toolkit choice costs one of 6 changes (2 minimum) and shows its heat cost. The player changes a box by dropping a toolkit item on it and picking one of 2 to 4 plain-language options. **Nothing is typed**, except the optional note.

| Box | What the player sees | IEEE-CIS columns it sets |
| --- | --- | --- |
| 💳 Card | "Visa debit, Ohio bank, cardholder Pat M." | `card1`–`card6`, `addr1`, `addr2` (billing) |
| 👤 Buyer | "pat.m@gmail.com, account 2 years old" | `P_emaildomain`, `M1`–`M3`, `D1` |
| 📦 Ship to | "Same as billing" / "Mule in Ohio" / "Reshipper overseas" / "Digital, no shipping" | `dist1`, `R_emaildomain` (gift recipient), `M4`–`M6` |
| 💻 Device | "Pat's iPhone" / "Fresh Android emulator" / "Same laptop as last time" | `DeviceType`, `DeviceInfo`, `id_30` (OS), `id_31` (browser), `id_33` (screen), `id_23` (proxy), `dist2` |
| 🛒 Cart & time | Products picked from the shop page, plus the clock | `TransactionAmt`, `ProductCD`, `TransactionDT` |

Each option shows a one-line "what Gus sees" hint, the same way the current scheme tips work.

## 3. The toolkit (replaces the 6 tools)

| Key | Item | What it does | Main columns |
| --- | --- | --- | --- |
| 1 | 💳 Card market | Swap the card: fresh or aged, debit or credit, brand, issuing region | `card1`–`card6`, `addr1`, `D1` |
| 2 | 📧 Burner email | gmail, yahoo, anonymous.com, protonmail, or "looks like the cardholder" | `P_emaildomain`, `R_emaildomain`, `M1`–`M3` |
| 3 | 🌐 VPN / proxy | None, transparent, anonymous, residential "next door" | `id_23`, `dist2`, `addr2` |
| 4 | 📱 Device spoofer | Change device type, OS, browser and screen, or reuse one | `DeviceType`, `DeviceInfo`, `id_30`, `id_31`, `id_33` |
| 5 | 📦 Drop address | Billing, nearby mule, reshipper, digital goods | `dist1`, `M4`–`M6`, `ProductCD` |
| 6 | ⏰ Clock | Buy now, at 3 AM, or **wait N days** (ages the card or account) | `TransactionDT`, `D` gaps |

Shop perks are reskinned the same way. Some examples: "Aged Accounts" (stolen accounts come with history), "Clean Proxies" (residential IPs) and "Card Checker" (shows whether a card is still live).

## 4. Campaigns: multi-step schemes, still simple

A campaign is a short strip of **1 to 5 orders**, drawn like comic panels under the ticket.

- **+ Next order** copies the current ticket, so the player only changes what's different. A typical change is the amount, the wait, or a new shipping address.
- The strip is what makes the IEEE-CIS **count (`C1`–`C14`) and time-gap (`D1`–`D15`) columns** meaningful. These columns are computed by the server from the strip and the card's history. The player never sets them directly.
- Gus scores **every** order in the strip. Card testing (three small charges, then a big one) can be caught on the third order.
- Payout comes only from orders that pass, so a long chain is high risk and high reward.

Starter schemes, each a ready-made campaign the player can edit:

| Scheme | Strip | Fraud pattern it teaches the model |
| --- | --- | --- |
| Card testing | $1.99 → $2.49 → $899 laptop | Small probe charges, then a cash-out |
| Account takeover | Log in from a "new" device → change shipping → buy | Device and address change on an aged account |
| Gift card flip *(built; was "Reshipper")* | A big gift card on a cheap foreign card, emailed to your burner | Digital goods, anonymous email, foreign card. Reshipping abroad is a drop-address option instead |
| Slow burn | Wait 7 days between normal-looking buys | Low velocity, blending in |
| Blank kit | One empty ticket | Whatever the player invents |

## 5. The data row: IEEE-CIS format

Each order in a strip becomes **one row** that joins the IEEE-CIS `transaction` and `identity` tables, plus game metadata columns.

| Column group | Who fills it | How |
| --- | --- | --- |
| `TransactionID`, `TransactionDT`, `TransactionAmt`, `ProductCD` | Server | DT is game-clock seconds, offset into the dataset's DT range |
| `card1`–`card6`, `addr1`, `addr2`, `P/R_emaildomain`, `dist1/2` | Toolkit choice, then server | Drawn from the **dataset's own value lists**, so a game card looks like a dataset card |
| `C1`–`C14`, `D1`–`D15` | Server | Computed from the campaign strip and the card, email and device history in this run |
| `M1`–`M9` | Server | Set from the match choices (name, address, email). Their exact meaning in IEEE-CIS is anonymized, so this mapping is our best guess. |
| `id_01`–`id_38`, `DeviceType`, `DeviceInfo` | Device and proxy choice | Same value lists as the dataset |
| `V1`–`V339` | Nobody | Left as NaN. Vesta engineered them and they can't be rebuilt. |
| `isFraud` | Server | 1 for player orders |
| Game-only: `session_id`, `origin`, `scheme_id`, `campaign_id`, `step`, `verdict`, `score`, `top_reasons`, `detector_version`, `cover_note` | Server | Never shown to the model |

Two consequences for B:
- The detector should train on the **columns the game can produce**, roughly 80 of them, with no V-columns. Otherwise it would score real rows and game rows differently.
- To stop the model learning "game row vs dataset row" instead of "fraud vs legit", every game value is drawn from the dataset's distribution. On top of that, a held-out check trains a small classifier to tell game rows from dataset rows; if it can, something leaks.

**Legit rows** are sampled from real `isFraud = 0` IEEE-CIS rows and mixed into Gus's queue, the same way the legit generator was planned for invoices.

## 6. What changes, by owner

| Owner | Work |
| --- | --- |
| **C, computer (`game.js`, `os.html`)** | Order ticket, toolkit, campaign strip, scheme kits, tutorial text. `record()` emits the order fields. Biggest piece. |
| **B, ML (`ml/`)** | `Transaction` schema in the IEEE-CIS format, the C and D column computation, value lists from the dataset, training without V-columns, the leak check |
| **A, server (`server/`)** | Round endpoints take a campaign (a list of orders), legit sampling from the dataset, row storage |
| **D, 3D office** | Order slip prop, Gus as the risk engine (booth labels, TV, posters), declined/chargeback effects |

## 7. Built in the prototype

- **Scripted Gus** (`judgeOrders` in `orders.js`): rule-based tells per order (anonymous email, brand-new card, IP far from billing, VPN, emulator, new device on an old account, one device with several cards, far shipping, big gift card, test charges then a big one, velocity, odd hours). Memo rules weigh 1.5×, and each tell that caught you weighs 30 % more for the rest of the run. Gus's skill grows with his version, so sloppy schemes pass at v1 and fail by v3–v5 while blended ones keep working.
- **Run memory:** cards, emails, devices and addresses are remembered across rounds, so reusing your laptop on a new card raises `C11` and the "one device, several cards" tell.
- **Rows:** `toRows()` builds the 434 IEEE-CIS columns plus 12 game columns per order. The comment above it says how each C, D, M and id_ column is filled. Value lists are typed in by hand from common dataset values: B should swap them for lists read from the CSV.
- **Export:** rows are kept in the browser (`localStorage`, last 3,000) and download as a CSV from the D panel.
- **Verdict values:** `APPROVED`, `DECLINED`, or `BLOCKED` (never scored: the card was already declined or reported earlier in the campaign).

## 8. Open questions

1. Do we keep invoice fraud as a first level for the demo, or replace it completely?
2. Is the IEEE-CIS CSV already in the team's environment, and where? The value lists in section 5 need it.
3. Should Gus's verdict use the real trained model from day one, or a scripted stand-in until B's model is ready?
