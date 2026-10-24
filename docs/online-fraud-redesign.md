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

## 8. v0.3: plan cards and ranks (built, replaces the ticket UI)

Playtest feedback on v0.2: too complicated, too much text, and the data collection showed. So the player-facing layer changed; the rows and the scripted Gus did not.

- **The plan:** one sentence with blanks, filled with picture cards from a hand of 3 dealt into the dock: WHO (a disguise like "👵 Grandma's account" or "🕶️ The Ghost"), WHAT (an item from the shop), WHEN, WHERE (where the loot goes), and a TRICK ("🧪 Test the card", "🔁 Do it 3 times", "🐢 Warm it up"…). `buildCampaign()` in `orders.js` turns the plan into the orders behind the scenes. Random hands mean less to read, rounds that feel different, and more varied data.
- **Ranks** unlock one blank at a time (Rookie: what + where … Mastermind: tweak each part of the disguise, which is where the most creative combinations come from). The support chat and the memo only appear from ranks 2 and 3.
- **Hidden data:** no rows, columns or CSV for players. Gus explains himself in plain words. The data panel and CSV need `?debug` in the URL.
- **Data note for B:** a row's `scheme_id` is now `<who>+<trick>` (plus `+custom` when a Mastermind tweaked the disguise), and `record()` sends the `plan` and the player's `rank`. Low ranks produce less varied rows (the defaults fill the missing blanks), so B may want to weight rows by rank.

## 9. v0.4: typed checkout, Gus learns only from wins (built, replaces the plan cards)

Playtest feedback on v0.3: losing made Gus stronger, so a losing player could never catch up, and picking cards felt too narrow.

- **Typed checkout:** one question per screen, like a real checkout: item (and price), name and email, device, where you shop from, delivery, timing and repeats. Players type anything; suggestion chips help. Keyword parsers in `orders.js` turn the text into the dataset's vocabulary: any email domain becomes `P_emaildomain` (anonymous providers and unusual domains are flagged), device text becomes `DeviceInfo`/`id_30`/`id_31`/`id_33` strings, a city becomes `dist1`/`dist2` in miles from the victim (a 50-city table), "VPN"/"Tor" become `id_23`, item text becomes `ProductCD` and a price, and typing the victim's real email is an account takeover (`M3`, account history in `C13`/`D4`). No AI: an LLM could replace the parsers later.
- **Learning only from wins:** a catch changes nothing. A win raises Gus's version (skill grows slowly and is capped), weighs the warning signs that were present in the winning order up to 1.8×, and stores the order's fingerprint (11 coarse row fields); a later order matching 9+ of them gets a "copycat" tell. Saved per shop across runs.
- **Gus's gut feeling:** the same rules without the dice, shown as a face while typing. It makes the game winnable by experimenting, and the experimenting is exactly the evasion data we want.
- **Balance (simulated, 300 careers of 20 rounds):** win rate starts near 100 % and drifts down as Gus studies wins. Overall: 50 % sending the first idea, 71 % trying 3 ideas per round, 86 % trying 8. One trick repeated is caught from round 2; sloppy orders (Tor, emulator, ProtonMail, shipping abroad) almost always lose.
- **Data note for B:** `record()` now sends the typed `input` and the player's `rank`; rows have `scheme_id` `typed-r<round>`. Free text means the long tail of email domains and devices will be wider than the dataset's; values outside the dataset's vocabulary still go into the row as typed.

## 9b. Server: online records are saved (built)

`POST /submit` accepts the checkout's record (`mode: "online"`, see `OnlineRecord` in `server/models/schemas.py`), in both the stub and the real server. The server appends every order's row to `server/data/ieee_rows.csv` (or `FORGED_DATA_DIR`): the 434 IEEE-CIS columns, the game's columns and `player`, git-ignored. The verdict comes from the fraud model in `ml/online` (see its README): LightGBM trained on the dataset's online segment plus simulated shoppers, retrained in the background on the orders that get through, and promoted only if it passes a gate on real and player data. Without a trained model, the server answers with the scripted Gus the browser sends as `gus`.

Questions a rank doesn't ask yet now default to a quiet starter kit: the victim's own login, their kind of phone, their city. Rookies choose only what to buy and where it goes, and the model judges those fairly.

After a catch, **Try again** replays the same victim and card with the answers filled in. It opens on the step Gus caught, and the lines that gave you away blink red until you change them.

## 10. Open questions

1. Do we keep invoice fraud as a first level for the demo, or replace it completely?
2. Is the IEEE-CIS CSV already in the team's environment, and where? The value lists in section 5 need it.
3. Should Gus's verdict use the real trained model from day one, or a scripted stand-in until B's model is ready?
