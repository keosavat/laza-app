# ການເປີດໂຕະ ແລະ ລູກຄ້າສະແກນ QR ສັ່ງອາຫານ (AppZap V2)
> ທົດລອງຕົວຈິງວັນທີ 22/11/2026 ທີ່ໂຕະກາງ 03: ເປີດໂຕະດ້ວຍ QR → ສັ່ງ 1 ລາຍການຈາກໜ້າລູກຄ້າ → ຍົກເລີກລາຍການ → ປິດໂຕະ (ບໍ່ມີຂໍ້ມູນຄ້າງໃນລະບົບ)

## 1. ຝັ່ງພະນັກງານ: ເປີດໂຕະ
ກົດໂຕະວ່າງ → panel ຂວາ **"Actions"**:

| ຊ່ອງ | ລາຍລະອຽດ |
|---|---|
| Guest Count | ຈຳນວນແຂກ (ຄ່າເລີ່ມຕົ້ນ = ບ່ອນນັ່ງຂອງໂຕະ) |
| QR Session Duration | Unlimited (ຈົນປິດໂຕະ) · 1 ຊມ (Quick Buffet) · 2 ຊມ (Standard Buffet) · 3 ຊມ (Extended Buffet) · 4 ຊມ (Fine Dining) |
| ປຸ່ມ **Open Table** | ເປີດໂຕະທຳມະດາ (ບໍ່ມີ QR) |
| ປຸ່ມ **Open with QR Code** | ເປີດໂຕະ + ສ້າງ QR session ພ້ອມກັນ → popup QR |

**Popup QR**: QR code, ຊື່ໂຕະ, link `mobile-order-v2.appzap.la/qr/<token>` + ປຸ່ມ copy, ປະເພດ ("Regular Dine In — QR ໝົດອາຍຸເມື່ອປິດໂຕະ"), ສະຖານະ active, ເວລາທີ່ໃຊ້ໄປ, ປຸ່ມ **ພິມ** (ພິມ QR ໃສ່ເຄື່ອງພິມໃບບິນ ເອົາໄປວາງໂຕະ). ເປີດຄືນໄດ້ທຸກເວລາຈາກໄອຄອນ QR ຢູ່ຫົວ panel ໂຕະ.

### API
```
POST /api/v1/tables/:tableId/open
{ serverId, customers: { count, guestCount },
  createQrSession: true,
  qrSessionOptions: { requiresAccessCode, maxDevices, allowOrdering, allowPayment,
                      requiresApproval, autoConfirmOrders, durationType } }
→ { session: { tableId, tableName, status, guestCount, startTime, runningTotal, billPrinting, timeCharge, metadata:{qrSessionId} ... },
    qrSession: { sessionId, type, status, shortUrl, accessCode, expiresAt,
                 settings:{ allowOrdering, allowPayment, requiresApproval, autoConfirmOrders },
                 security:{ requiresAccessCode, maxDevices }, tableSessionId, tableId, tableName } }
```
ຈຸດສຳຄັນ: **QR ຜູກກັບ table session (ຮອບນັ່ງ) ບໍ່ແມ່ນຜູກກັບໂຕະ** → ລູກຄ້າຊຸດກ່ອນສັ່ງຊ້ຳບໍ່ໄດ້ຫຼັງປິດໂຕະ. ນອກຈາກນີ້ຍັງມີ **permanent QR sticker** ຕໍ່ໂຕະ (`tables.permanentQr.token`) ແລະ **QR takeaway/pickup** ຖາວອນ (`/qr-sessions/permanent-pickup/active`).

## 2. ຝັ່ງລູກຄ້າ: ໜ້າສັ່ງອາຫານ (mobile web, ບໍ່ຕ້ອງຕິດຕັ້ງແອັບ)
ແຖບລຸ່ມ 3 ແຖບ:
1. **ເມນູ** — ຊື່ຮ້ານ + ຊື່ໂຕະ, ປຸ່ມປ່ຽນພາສາ, ຄົ້ນຫາ, pills ໝວດ (ເລື່ອນໄປຫາໝວດ), ສະລັບ grid/list, ປຸ່ມ `+` ຕໍ່ລາຍການ. ເມື່ອມີສິນຄ້າ → ແຖບລຸ່ມ "ເບິ່ງກະຕ່າ · n ລາຍການ"
2. **ກະຕ່າ** (sheet ເຕັມຈໍ) — ລາຍການ, −/+ ຈຳນວນ, ລຶບ, ລວມທັງໝົດ, ປຸ່ມ **ສັ່ງເພີ່ມ** (ກັບໄປເມນູ) ແລະ **ສັ່ງເລີຍ**
3. **ຄຳສັ່ງ** — ທຸກອໍເດີຂອງໂຕະນີ້ (#ເລກ, ສະຖານະ ເຊັ່ນ "ຢືນຢັນແລ້ວ", ເວລາ), ສະຖານະແຕ່ລະລາຍການ, **ຍອດລວມ / ຍອດທີ່ຕ້ອງຈ່າຍ**
4. **QR** — ສະແດງ QR ດຽວກັນ ໃຫ້ໝູ່ຮ່ວມໂຕະສະແກນ + ຄຳເຕືອນ "ຢ່າເປີດເຜີຍໃຫ້ຄົນທີ່ບໍ່ໄດ້ນັ່ງໂຕະດຽວກັນ"

ຫຼັງປິດໂຕະ ເປີດ link ເກົ່າ → ໜ້າ **"Table Closed"** (ຂອບໃຈ, ສະແກນ QR ໃໝ່ ຫຼື ເອີ້ນພະນັກງານ).

### Public API (ບໍ່ຕ້ອງ login, ໃຊ້ token ໃນ URL)
```
POST /api/v1/public/qr/access                 ກວດ token / ລົງທະບຽນອຸປະກອນ
GET  /api/v1/public/qr/:token/menu            ເມນູ + ໝວດ (ສະເພາະທີ່ເປີດຂາຍ)
POST /api/v1/public/qr/:token/orders          { lineItems: [{ menuItemId, quantity, selectedOptions: [] }] }  → 201
GET  /api/v1/public/qr/:token/orders          ອໍເດີຂອງ session
GET  /api/v1/public/qr/:token/bill            ຍອດທີ່ຕ້ອງຈ່າຍ
```
ລາຄາຄິດຢູ່ເຊີບເວີ (ລູກຄ້າສົ່ງແຕ່ menuItemId + ຈຳນວນ).

## 3. ຫຼັງລູກຄ້າສັ່ງ: ຝັ່ງພະນັກງານ
- ລາຍການຂຶ້ນໃນ panel ໂຕະ **ທັນທີ (realtime)**, ຖັນ "ຈາກ" = **Customer**, ສະຖານະ CONFIRMED (ເພາະຕັ້ງ Customer Orders = Auto-confirmed)
- ເມນູ Orders ມີ badge ຈຳນວນ, ປຸ່ມ "Print Kitchen (1)" ສະແດງຈຳນວນທີ່ຍັງບໍ່ພິມ
- ເລືອກ checkbox ລາຍການ → ປຸ່ມ SERVED / PREPARING / READY / CANCEL ແບບກຸ່ມ
- ຍົກເລີກຕ້ອງເລືອກເຫດຜົນຈາກລາຍການ: Customer Request, Changed Mind, Allergy, Dietary Restriction, Out of Stock, Ingredient Unavailable, Kitchen Error, Quality Issue, Preparation Time Exceeded, Staff Error, System Error, Duplicate Order...
- ຕັ້ງຄ່າ (Settings → Printers → Order Creation): Customer Orders = Auto-confirmed ຫຼື ຕ້ອງໃຫ້ພະນັກງານຢືນຢັນກ່ອນ (`requiresConfirmation`, `autoConfirmTimeout`)

## 4. ຈຸດອ່ອນທີ່ສັງເກດ
- QR ຮອບນັ່ງໃຊ້ໄດ້ທຸກຄົນທີ່ມີ link (maxDevices ມີແຕ່ບໍ່ໄດ້ບັງຄັບໃນ UI), ບໍ່ມີ access code ເປັນຄ່າເລີ່ມຕົ້ນ
- ລູກຄ້າບໍ່ສາມາດ "ເອີ້ນພະນັກງານ" ຫຼື "ຂໍບິນ" ຈາກໜ້າເວັບ
- ຮູບເມນູເປັນ placeholder ເມື່ອຮ້ານບໍ່ອັບໂຫຼດ; ໜ້າລູກຄ້າບໍ່ສະແດງຕົວເລືອກ (options) ເມື່ອກົດ `+` ສຳລັບເມນູທີ່ບໍ່ມີ options

## 5. ອອກແບບສຳລັບ LAZA app (Phase 2 — QR Ordering)
**ຖານຂໍ້ມູນ**
- `orders` ເພີ່ມ `qr_token` (random 32 bytes, unique), `qr_expires_at`, `guest_count`, `source` (`staff`|`customer`)
- `order_items.source` + `confirmed_at`; ສະຖານະໃໝ່ `awaiting` (ລໍຖ້າພະນັກງານຢືນຢັນ) ກ່ອນ `pending`
- `branches`: `qr_auto_confirm` (bool), `qr_enabled`, `public_url`
- `qr_calls` (call waiter / request bill): order_id, type, created_at, handled_by

**API ສາທາລະນະ** (rate-limit ຕໍ່ IP + token, ບໍ່ສົ່ງຂໍ້ມູນພາຍໃນ ເຊັ່ນ ຕົ້ນທຶນ)
```
GET  /api/public/qr/:token            ຮ້ານ, ໂຕະ, ສະຖານະ session (open/closed/expired)
GET  /api/public/qr/:token/menu       ໝວດ + ເມນູ + options (ບໍ່ມີ cost)
POST /api/public/qr/:token/orders     { items:[{menuItemId, qty, options, note}] }
GET  /api/public/qr/:token/orders     ລາຍການ + ສະຖານະ + ຍອດ (realtime ຜ່ານ socket room qr:<token>)
POST /api/public/qr/:token/call       { type: 'waiter' | 'bill' }
```
**ຝັ່ງພະນັກງານ**
- ໜ້າໂຕະ: ປຸ່ມ "ເປີດໂຕະ" ແລະ "ເປີດ + QR" (ຈຳນວນແຂກ, ໄລຍະເວລາ: ບໍ່ຈຳກັດ/1–4 ຊມ), popup QR + ພິມ QR 80mm
- ໄອຄອນ QR ໃນໜ້າອໍເດີ ເພື່ອເປີດ/ພິມຄືນ, ປຸ່ມ "ສ້າງ QR ໃໝ່" (ຍົກເລີກ token ເກົ່າ)
- ລາຍການຈາກລູກຄ້າ: ປ້າຍ "ລູກຄ້າ", ຖ້າປິດ auto-confirm → ແຈ້ງເຕືອນ + ປຸ່ມ ຢືນຢັນ/ປະຕິເສດ
- ແຈ້ງເຕືອນສຽງ "ໂຕະ A01 ເອີ້ນພະນັກງານ / ຂໍບິນ"
- ປິດໂຕະ (ຊຳລະ/ຍົກເລີກ) → token ໝົດອາຍຸທັນທີ

**ໜ້າລູກຄ້າ** (`/m/:token`, mobile-first, ໃນ web app ດຽວກັນ): ເມນູ + ຄົ້ນຫາ + ໝວດ, ເລືອກ options, ກະຕ່າ, ສັ່ງ, ແຖບ "ອໍເດີຂອງຂ້ອຍ" ສະຖານະ realtime, ປຸ່ມ ເອີ້ນພະນັກງານ / ຂໍບິນ, ໜ້າ "ໂຕະປິດແລ້ວ", ພາສາ ລາວ/ອັງກິດ
