# LAZA public API v1 + Webhooks

ໃຫ້ລະບົບພາຍນອກ (ແອັບ delivery, ເວັບໄຊຮ້ານ, ລະບົບບັນຊີ) ເຊື່ອມກັບ LAZA. ການຕັ້ງຄ່າເຮັດໃນເມນູ **ການເຊື່ອມຕໍ່ (API)** (ສະເພາະບັນຊີເຈົ້າຂອງຮ້ານ).

> ເພື່ອໃຫ້ລະບົບນອກຮ້ານເອີ້ນໄດ້ ເຊີບເວີຕ້ອງເຂົ້າເຖິງໄດ້ຈາກອິນເຕີເນັດ (ເບິ່ງ [HOSTING.md](HOSTING.md)). ໃນຕົວຢ່າງລຸ່ມນີ້ໃຊ້ `https://pos.example.com`.

---

## 1. API key

1. ເຂົ້າ **ການເຊື່ອມຕໍ່ (API)** → **ສ້າງ key**, ຕັ້ງຊື່ ແລະ ເລືອກສິດ.
2. ກ໊ອບ key ທີ່ຂຶ້ນຕົ້ນດ້ວຍ `lz_…` — **ສະແດງຄັ້ງດຽວ**. LAZA ເກັບສະເພາະ hash ຈຶ່ງເອົາ key ເກົ່າມາເບິ່ງຄືນບໍ່ໄດ້ (ເສຍແລ້ວຕ້ອງສ້າງໃໝ່).
3. ສົ່ງໃນທຸກຄຳຂໍ:

```
Authorization: Bearer lz_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

| ສິດ (scope) | ໃຊ້ເຮັດຫຍັງ |
|---|---|
| `menu:read` | ອ່ານເມນູ ແລະ ສະຖານະໝົດ |
| `orders:read` | ອ່ານອໍເດີ |
| `orders:write` | ສ້າງ ແລະ ຍົກເລີກອໍເດີ **ທີ່ສ້າງຜ່ານ API** |
| `reports:read` | ອ່ານຍອດຂາຍລາຍວັນ |

- key ຜູກກັບສາຂາທີ່ສ້າງ ແລະ ເຫັນສະເພາະຂໍ້ມູນສາຂານັ້ນ.
- ຍົກເລີກ key ໄດ້ທຸກເວລາ ແລະ ມີຜົນທັນທີ.
- ຈຳກັດ **120 ຄຳຂໍ/ນາທີ/key** (ປ່ຽນດ້ວຍ `LAZA_API_RATE`). ເກີນຈະໄດ້ `429` ພ້ອມ `Retry-After`. ທຸກຄຳຕອບມີ `X-RateLimit-Remaining`.
- ຂໍ້ຜິດພາດເປັນ JSON `{ "error": "ຂໍ້ຄວາມ" }` ພ້ອມ HTTP code: `400` ຂໍ້ມູນຜິດ, `401` key ບໍ່ຖືກ, `403` ບໍ່ມີສິດ, `404` ບໍ່ພົບ, `409` ຂັດແຍ້ງ (ເຊັ່ນ ຍັງບໍ່ໄດ້ເປີດກະ), `429` ຖີ່ເກີນ.
- ເງິນເປັນເລກຖ້ວນ **ກີບ (LAK)**. ເວລາເປັນ ISO 8601 (UTC).

## 2. Endpoints

### `GET /api/v1/menu` — `menu:read`
```bash
curl -H "Authorization: Bearer $KEY" https://pos.example.com/api/v1/menu
```
```json
{
  "categories": [{ "id": 1, "name": "ເຄື່ອງດື່ມ" }],
  "items": [
    { "id": 12, "category_id": 1, "name": "ເບຍລາວ", "price": 15000,
      "options": [{ "name": "ຂະໜາດ", "required": true, "multiple": false, "choices": [{ "name": "ໃຫຍ່", "price": 5000 }] }],
      "sold_out": false }
  ]
}
```
ບໍ່ມີຕົ້ນທຶນ. `sold_out: true` ເມື່ອສະຕັອກບໍ່ພໍເຮັດ.

### `GET /api/v1/orders` — `orders:read`
ຕົວກອງ: `status` (`open|paid|cancelled`), `from` ແລະ `to` (`YYYY-MM-DD` ຕາມເວລາຂອງສາຂາ, ນັບຈາກເວລາສ້າງ), `external_ref`, `limit` (1–100, ເລີ່ມຕົ້ນ 50), `after` (id ຈາກ `next_after` ເພື່ອເປີດໜ້າຕໍ່ໄປ).
```json
{ "data": [ { "id": 41, "order_no": "000041", "type": "takeaway", "status": "open", "total": 45000, "items": [ … ] } ], "next_after": 38 }
```
ເລຽງໃໝ່ສຸດກ່ອນ. `next_after` ເປັນ `null` ເມື່ອໝົດ.

### `GET /api/v1/orders/{id}` — `orders:read`
ອໍເດີດຽວ (ໂຄງສ້າງດຽວກັບຂ້າງເທິງ ພ້ອມ `payments`).

### `POST /api/v1/orders` — `orders:write`
ສ້າງອໍເດີ **ກັບບ້ານ** ຈາກລະບົບນອກ.
```bash
curl -X POST https://pos.example.com/api/v1/orders \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "source": "grabfood",
    "externalRef": "G-1001",
    "customerName": "ນາງ ມາລີ",
    "phone": "020 5555 1234",
    "note": "ບໍ່ເຜັດ",
    "items": [
      { "menuItemId": 12, "qty": 2, "options": [{ "group": "ຂະໜາດ", "name": "ໃຫຍ່" }], "note": "ບໍ່ໃສ່ນ້ຳກ້ອນ" }
    ]
  }'
```
- `source` (a-z, 0-9, `_`, `-`) + `externalRef` ຄືເລກອໍເດີຂອງຝັ່ງທ່ານ. **ສົ່ງຄູ່ດຽວກັນຊ້ຳ ຈະໄດ້ອໍເດີເດີມ** (`200`, `"idempotent": true`) ບໍ່ສ້າງຊ້ອນ — ປອດໄພທີ່ຈະ retry ເມື່ອເນັດຫຼຸດ.
- ຕ້ອງມີກະເປີດຢູ່, ບໍ່ດັ່ງນັ້ນໄດ້ `409`.
- ເມນູ/ຕົວເລືອກທີ່ບໍ່ມີ, ຕົວເລືອກບັງຄັບທີ່ຂາດ, ແລະ ເມນູທີ່ໝົດ ຈະຖືກປະຕິເສດ. ລາຄາຄິດຈາກເມນູໃນລະບົບສະເໝີ (ບໍ່ຮັບລາຄາຈາກຄຳຂໍ).
- **ຖ້າ key ບໍ່ໄດ້ຕິກ "ສົ່ງເຂົ້າຄົວທັນທີ"**: ລາຍການລໍໃຫ້ພະນັກງານຢືນຢັນ (ມີສຽງ/ແຈ້ງເຕືອນ) ແລະ `total` ເປັນ 0 ຈົນກວ່າຈະຢືນຢັນ. ຖ້າຕິກ: ເຂົ້າຄົວທັນທີ ແລະ ຄິດເງິນເລີຍ.
- ອໍເດີມີ `status: "open"`. ການຊຳລະເງິນເຮັດທີ່ໜ້າຮ້ານ ຫຼື ຜ່ານ webhook `order.paid`.

### `POST /api/v1/orders/{id}/cancel` — `orders:write`
```json
{ "reason": "ລູກຄ້າຍົກເລີກ" }
```
ຍົກເລີກໄດ້ສະເພາະອໍເດີທີ່ **ສ້າງຜ່ານ API** ແລະ ຍັງ `open`. ອໍເດີອື່ນໄດ້ `403`.

### `GET /api/v1/reports/daily?date=YYYY-MM-DD` — `reports:read`
```json
{ "date": "2026-11-25", "currency": "LAK", "bills": 42, "sales": 3150000, "discount": 50000, "service": 0, "vat": 0,
  "by_method": { "cash": 2000000, "transfer": 1150000 } }
```
ບໍ່ໃສ່ `date` = ມື້ນີ້ (ຕາມເວລາຂອງສາຂາ). ນັບສະເພາະບິນທີ່ຊຳລະແລ້ວ.

---

## 3. Webhooks

LAZA ສົ່ງ `POST` ຮູບແບບ JSON ໄປທີ່ URL ຂອງທ່ານເມື່ອເກີດເຫດການ. ຕັ້ງທີ່ **ການເຊື່ອມຕໍ່ (API)** → **Webhooks**: ໃສ່ URL, ເລືອກເຫດການ, ກົດ **ທົດສອບ**. **Secret** (`whsec_…`) ສະແດງຄັ້ງດຽວຕອນສ້າງ/ປ່ຽນ.

| ເຫດການ | ເກີດເມື່ອ |
|---|---|
| `order.created` | ສ້າງອໍເດີ (ໜ້າຮ້ານ ຫຼື API) |
| `order.paid` | ຊຳລະເງິນແລ້ວ |
| `order.cancelled` | ຍົກເລີກອໍເດີ |
| `shift.closed` | ປິດກະ |
| `reservation.created` | ມີການຈອງໂຕະໃໝ່ |
| `ping` | ກົດ "ທົດສອບ" (ສົ່ງຫາປາຍທາງນີ້ສະເໝີ) |

ຕົວຢ່າງ body:
```json
{
  "id": "evt_9f2c1a7b0d3e4f56a1b2c3d4",
  "type": "order.paid",
  "created_at": "2026-11-25T09:30:12.000Z",
  "branch_id": 1,
  "data": { "id": 41, "order_no": "000041", "bill_no": "B000030", "status": "paid", "total": 45000,
            "items": [ { "name": "ເບຍລາວ", "qty": 3, "unit_price": 15000 } ],
            "payments": [ { "method": "cash", "currency": "LAK", "amount": 45000, "amount_lak": 45000 } ] }
}
```
Header: `X-Laza-Event`, `X-Laza-Delivery` (id ການສົ່ງ), `X-Laza-Signature`.

### ກວດລາຍເຊັນ (ສຳຄັນ)
`X-Laza-Signature: t=<unix seconds>,v1=<hex>` ໂດຍ `v1 = HMAC-SHA256(secret, "<t>." + <body ດິບ>)`. ໃຫ້ກວດ **ກ່ອນ** ເຊື່ອຂໍ້ມູນ ແລະ ປະຕິເສດຖ້າ `t` ເກົ່າກວ່າ ~5 ນາທີ (ກັນຖືກສົ່ງຊ້ຳ).

Node.js
```js
import crypto from 'node:crypto';
function verify(rawBody, header, secret) {
  const [t, v1] = header.split(',').map((p) => p.split('=')[1]);
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  return fresh && expected.length === v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
```
Python
```python
import hmac, hashlib, time
def verify(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return abs(time.time() - int(parts["t"])) < 300 and hmac.compare_digest(expected, parts["v1"])
```
ໃຊ້ **body ດິບ** (ກ່ອນ parse JSON) ຕອນຄຳນວນ.

### ການສົ່ງ ແລະ ການລອງໃໝ່
- ຕອບ `2xx` ພາຍໃນ 10 ວິນາທີ = ສຳເລັດ. ອັນອື່ນ/ໝົດເວລາ = ລົ້ມ.
- ລົ້ມແລ້ວ LAZA ລອງໃໝ່ຫຼັງ 1 ນາທີ, 5 ນາທີ, 30 ນາທີ, 2 ຊົ່ວໂມງ, 12 ຊົ່ວໂມງ (ລວມ 6 ຄັ້ງ) ແລ້ວຢຸດ ("ຍົກເລີກສົ່ງ"). ກົດ **ລອງສົ່ງ** ໃນ "ປະຫວັດສົ່ງ" ເພື່ອສົ່ງດ້ວຍມືໄດ້.
- ເຫດການຖືກເກັບກ່ອນສົ່ງ (outbox) ຈຶ່ງບໍ່ຫາຍເມື່ອຝັ່ງຮັບລົ່ມຊົ່ວຄາວ, ແຕ່ **ອາດມາຊ້ຳ ຫຼື ບໍ່ເຂົ້າລຳດັບ** — ໃຫ້ຝັ່ງຮັບໃຊ້ `id` (`evt_…`) ກັນປະມວນຜົນຊ້ຳ.
- URL ຕ້ອງເປັນ `https://` (ຫຼື `http://` ສຳລັບລະບົບໃນເຄືອຂ່າຍຮ້ານ). ບໍ່ອະນຸຍາດ URL ທີ່ມີຊື່ຜູ້ໃຊ້/ລະຫັດ ຫຼື ທີ່ຢູ່ metadata ຂອງ cloud (`169.254.x.x`).
- ປະຫວັດການສົ່ງເກັບ 30 ມື້.

## 4. ຄວາມປອດໄພ — ຂໍ້ຄວນຈຳ
- ໃຫ້ສິດ key ຕາມທີ່ຈຳເປັນເທົ່ານັ້ນ ແລະ ສ້າງແຍກຕໍ່ລະລະບົບ ເພື່ອຍົກເລີກແຕ່ລະອັນໄດ້.
- ຢ່າເອົາ key/secret ໃສ່ໃນແອັບມືຖື ຫຼື JavaScript ຝັ່ງຜູ້ໃຊ້ — ໃຫ້ເອີ້ນຈາກເຊີບເວີຂອງທ່ານເອງ.
- ເຮັດ webhook receiver ໃຫ້ກວດລາຍເຊັນສະເໝີ.
- ຍັງບໍ່ມີ: OAuth, ການເຊື່ອມກັບແພລດຟອມ delivery ສະເພາະເຈົ້າ (Grab/Foodpanda...) — ຕ້ອງມີຕົວແປງ (adapter) ຝັ່ງແພລດຟອມທີ່ເອີ້ນ API ນີ້.
