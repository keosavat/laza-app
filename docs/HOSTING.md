# ການເປີດໃຊ້ LAZA app ຈິງ (hosting)

## ສະຫຼຸບຄຳແນະນຳ

**ໃຫ້ເຊີບເວີຢູ່ທີ່ຮ້ານ (ຄອມ/ມິນິພີຊີຂອງຮ້ານ) ແລ້ວເປີດທາງເຂົ້າຈາກອິນເຕີເນັດດ້ວຍ Cloudflare Tunnel.**

ເຫດຜົນທີ່ແອັບນີ້ເໝາະກັບແບບນີ້ກວ່າການເອົາຂຶ້ນ cloud:

| ເລື່ອງ | ເຊີບເວີທີ່ຮ້ານ + Tunnel | ເຊີບເວີເທິງ cloud (Railway/Render/Fly) |
|---|---|---|
| ເຄື່ອງພິມຄົວ/ບິນ | ພິມໄດ້ ເພາະເຊີບເວີຢູ່ເຄືອຂ່າຍດຽວກັບເຄື່ອງພິມ (IP ພາຍໃນ) | **ພິມບໍ່ໄດ້** ເພາະ cloud ເຂົ້າເຖິງເຄື່ອງພິມ LAN ບໍ່ໄດ້ (ຕ້ອງມີໂປຣແກຣມຕົວແທນເພີ່ມ) |
| ອິນເຕີເນັດຂັດຂ້ອງ | ຮ້ານຍັງຂາຍ/ພິມໄດ້ປົກກະຕິໃນ Wi-Fi ຮ້ານ | ຂາຍບໍ່ໄດ້ ຈົນກວ່າເນັດຈະກັບມາ (ມີ offline mode ຊ່ວຍ ແຕ່ຈຳກັດ) |
| ຖານຂໍ້ມູນ | ໄຟລ໌ SQLite ໃນເຄື່ອງຮ້ານ | ຕ້ອງມີ disk ຖາວອນ (volume) ແລະ ບໍ່ແມ່ນທຸກແພັກເກດໃຫ້ |
| ຄ່າໃຊ້ຈ່າຍ | ຟຣີ (Cloudflare Tunnel) + ຄ່າ domain ~ $10/ປີ | ~ $5–10/ເດືອນຂຶ້ນໄປ |
| ຄວາມສ່ຽງ | ຕ້ອງເປີດເຄື່ອງຕະຫຼອດ ແລະ ສຳຮອງຂໍ້ມູນເອງ | ຜູ້ໃຫ້ບໍລິການຮັກສາເຄື່ອງ ແຕ່ເສຍຄ່າ ແລະ ຂໍ້ມູນຢູ່ນອກຮ້ານ |

**Vercel ໃຊ້ບໍ່ໄດ້**: ແອັບນີ້ເປັນເຊີບເວີທີ່ເປີດຄ້າງ (Socket.IO + ໄຟລ໌ຖານຂໍ້ມູນ) ບໍ່ແມ່ນ serverless.

ຖ້າໃນອະນາຄົດມີຫຼາຍສາຂາຫ່າງໄກກັນ ຫຼື ບໍ່ມີຄອມທີ່ຮ້ານ ຈຶ່ງຄ່ອຍພິຈາລະນາ cloud (ຕ້ອງເພີ່ມຕົວແທນພິມ).

---

## ຂັ້ນຕອນ (Windows)

### 1. ກຽມເຊີບເວີ
ຕ້ອງມີ Node.js 24+ ແລະ Git. ໃນໂຟລເດີໂປຣເຈັກ:

```powershell
npm.cmd install
npm.cmd run build
npm.cmd start
```

ເປີດ `http://localhost:4000` ໃຫ້ເຫັນໜ້າ login. ຖ້າບໍ່ເຫັນໃຫ້ກວດວ່າ `npm.cmd run build` ສຳເລັດ.

### 2. ປ່ຽນລະຫັດຜ່ານທົດລອງ (ສຳຄັນທີ່ສຸດ)
ບັນຊີທົດລອງ (`admin`, `manager`, `cashier`, `waiter`, `kitchen`) ໃຊ້ລະຫັດ `laza1234` ເຊິ່ງຢູ່ໃນ README ສາທາລະນະ.
ເຂົ້າ **ພະນັກງານ** ແລ້ວປ່ຽນລະຫັດຂອງທຸກບັນຊີ (ຢ່າງໜ້ອຍ 6 ຕົວ; ແນະນຳຍາວກວ່າ ແລະ ບໍ່ຊ້ຳກັນ).
ແອັບຈະຂຶ້ນແຖບສີແດງໃຫ້ເຈົ້າຂອງ/ຜູ້ຈັດການ ຈົນກວ່າຈະປ່ຽນຄົບ, ແລະ ເຕືອນໃນ terminal ຕອນເປີດເຊີບເວີ.

### 3. ໃຫ້ເຊີບເວີເປີດເອງເມື່ອເປີດເຄື່ອງ
ຕົວຢ່າງດ້ວຍ Task Scheduler (ແກ້ path ໃຫ້ຖືກ, ເປີດ PowerShell ແບບ Administrator):

```powershell
$dir = "D:\\path\\to\\Quan an"
$action = New-ScheduledTaskAction -Execute "npm.cmd" -Argument "start" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName "LAZA server" -Action $action -Trigger $trigger -RunLevel Highest
```

ຄວນຕັ້ງໃຫ້ຄອມບໍ່ sleep (Power options → Never) ແລະ ແນະນຳມີ UPS ກັນໄຟຕົກ.

### 4. ເປີດທາງເຂົ້າດ້ວຍ Cloudflare Tunnel
ຕ້ອງມີບັນຊີ Cloudflare (ຟຣີ) ແລະ domain ທີ່ຕັ້ງ nameserver ໄວ້ກັບ Cloudflare (ເພື່ອໃຫ້ URL ຄົງທີ່ ເຊັ່ນ `pos.ຊື່ຮ້ານ.com`).

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel login
cloudflared tunnel create laza
cloudflared tunnel route dns laza pos.example.com
```

ສ້າງໄຟລ໌ `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: laza
credentials-file: C:\Users\<ຊື່ເຄື່ອງ>\.cloudflared\<TUNNEL-ID>.json
ingress:
  - hostname: pos.example.com
    service: http://localhost:4000
  - service: http_status:404
```

ທົດລອງ `cloudflared tunnel run laza` ແລ້ວເປີດ `https://pos.example.com` ຈາກມືຖືທີ່ໃຊ້ເນັດມືຖື (ບໍ່ແມ່ນ Wi-Fi ຮ້ານ). ເມື່ອໃຊ້ໄດ້ ຕິດຕັ້ງເປັນ service:

```powershell
cloudflared service install
```

**ຖ້າຍັງບໍ່ມີ domain** ທົດລອງຊົ່ວຄາວໄດ້ດ້ວຍ `cloudflared tunnel --url http://localhost:4000` (ໄດ້ URL ແບບສຸ່ມ). URL ປ່ຽນທຸກຄັ້ງທີ່ເປີດໃໝ່ ຈຶ່ງບໍ່ເໝາະກັບ QR ທີ່ພິມແຂວນໃນຮ້ານ.

> ໝາຍເຫດ: ຂັ້ນຕອນ Cloudflare ຂ້າງເທິງຂຽນຕາມເອກະສານທາງການ ແຕ່ຍັງບໍ່ໄດ້ທົດສອບກັບບັນຊີ/domain ຈິງ. ຖ້າຄຳສັ່ງໃດຜິດ ໃຫ້ເບິ່ງ developers.cloudflare.com (Cloudflare Tunnel).

### 5. ຕັ້ງ URL ສາທາລະນະໃນແອັບ
ເຂົ້າ **ຕັ້ງຄ່າ** → ຊ່ອງ "ທີ່ຢູ່ເວັບທີ່ມືຖືລູກຄ້າເປີດໄດ້" ໃສ່ `https://pos.example.com` ເພື່ອໃຫ້ QR ຂອງໂຕະຊີ້ໄປທີ່ນີ້. ຈາກນັ້ນສະແກນ QR ດ້ວຍມືຖືຈິງ 1 ຄັ້ງເພື່ອກວດ.

### 6. ການປ້ອງກັນທີ່ມີໃນແອັບແລ້ວ
- ໃສ່ລະຫັດຜິດເກີນ 8 ຄັ້ງ (ຕໍ່ຊື່ຜູ້ໃຊ້ ຕໍ່ທີ່ຢູ່) ຫຼື 40 ຄັ້ງ (ຕໍ່ທີ່ຢູ່) ຈະຖືກລັອກ 10 ນາທີ.
- Header ຄວາມປອດໄພ (nosniff, frame, referrer) ແລະ HSTS ເມື່ອເຂົ້າຜ່ານ HTTPS.
- JWT secret ສຸ່ມສ້າງເອງ ແລະ ເກັບໃນ `server/data/jwt-secret` (ຢ່າແຈກ ແລະ ຢ່າ commit).
- ລະຫັດຜ່ານເກັບແບບ hash (bcrypt).

**ແນະນຳເພີ່ມ**: ເປີດ Cloudflare Access (ຟຣີສຳລັບເຖິງ 50 ຄົນ) ຄຽງ `/owner` ເພື່ອໃຫ້ຕ້ອງຢືນຢັນອີເມວກ່ອນເຫັນໜ້າ login ຂອງເຈົ້າຂອງ. ແຕ່ຢ່າໃສ່ກັບ `/m/*` (ໜ້າສັ່ງອາຫານຂອງລູກຄ້າ), `/api/public/*` ແລະ `/socket.io/*` (ອັບເດດສະຖານະອໍເດີ) ເພາະລູກຄ້າຕ້ອງສະແກນ QR ໄດ້ໂດຍບໍ່ມີບັນຊີ.

### 7. ສຳຮອງຂໍ້ມູນ
- ເຊີບເວີສຳຮອງຖານຂໍ້ມູນອັດຕະໂນມັດ **ມື້ລະ 1 ຄັ້ງ** ໄປ `server/data/backups/laza-YYYYMMDD.db` (ເກັບ 14 ມື້; ປ່ຽນດ້ວຍ `LAZA_BACKUP_KEEP`, ປ່ຽນບ່ອນເກັບດ້ວຍ `LAZA_BACKUP_DIR`).
- **ຕ້ອງກ໊ອບໂຟລເດີ `backups` ອອກໄປນອກເຄື່ອງ** (USB, Google Drive, ຄອມອື່ນ) ຢ່າງນ້ອຍອາທິດລະຄັ້ງ — ຖ້າຮາດດິກເສຍ ສຳຮອງໃນເຄື່ອງດຽວກັນກໍເສຍນຳ.
- ກູ້ຄືນ: ປິດເຊີບເວີ → ກ໊ອບໄຟລ໌ສຳຮອງໄປວາງເປັນ `server/data/laza.db` (ລຶບ `laza.db-wal` ແລະ `laza.db-shm` ຖ້າມີ) → ເປີດເຊີບເວີ.

### 8. ເຊັກລິດກ່ອນເປີດຈິງ
- [ ] ປ່ຽນລະຫັດທຸກບັນຊີແລ້ວ (ແຖບສີແດງຫາຍໄປ)
- [ ] ຕັ້ງຊື່ຮ້ານ, ທີ່ຢູ່, VAT/ຄ່າບໍລິການ, ອັດຕາແລກປ່ຽນໃນ **ຕັ້ງຄ່າ**
- [ ] ເຊື່ອມເຄື່ອງພິມຄົວ/ບິນ ແລະ ພິມທົດສອບຈາກໜ້າ **ເຄື່ອງພິມ**
- [ ] ສະແກນ QR ໂຕະດ້ວຍມືຖືຈິງ ແລະ ສັ່ງທົດລອງ
- [ ] ເປີດ `/owner` ຈາກມືຖືທີ່ໃຊ້ເນັດມືຖື
- [ ] ກ໊ອບໄຟລ໌ສຳຮອງອອກໄປນອກເຄື່ອງ 1 ຄັ້ງ ແລະ ທົດລອງກູ້ຄືນໃນເຄື່ອງອື່ນ
