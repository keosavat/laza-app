# ບົດວິເຄາະໂຄງສ້າງລະບົບ AppZap V2 (POS ຮ້ານອາຫານ)
> ສຶກສາວັນທີ 22/11/2026 ຈາກບັນຊີ "noy beer lao – Main Branch" (ສິດ Restaurant Admin), ເວີຊັນ v1.11.41
> ຈຸດປະສົງ: ເປັນແນວທາງອອກແບບລະບົບ POS ຮ້ານອາຫານຂອງພວກເຮົາເອງໃຫ້ຄົບຖ້ວນ ແລະ ດີກວ່າ

ຮູບໜ້າຈໍຢູ່ໃນ [screenshots/](screenshots/).

---

## 1. ພາບລວມ ແລະ Tech Stack

| ຊັ້ນ | ສິ່ງທີ່ພົບ |
|---|---|
| Frontend | React SPA (Vite build: `index-*.js`, `polyfills-legacy`), Tailwind CSS, i18n ດ້ວຍໄຟລ໌ `/locales/{lo,en,en-US}/translation.json` |
| State | Zustand + persist ໃນ `localStorage` (`auth-storage`, `table-store`, `permission-store`, `restaurant-settings-storage`, `appzap-bank-store`) |
| Auth | JWT access token + refresh token ເກັບໃນ localStorage (`appzap_auth_token`, `appzap_refresh_token`), ມີ `appzap_terminal_id` ລະບຸແຕ່ລະເຄື່ອງ |
| Backend | REST API ແຍກໂດເມນ `api-v2.appzap.la/api/v1/*`, ຮູບແບບຂໍ້ມູນເປັນ MongoDB (`_id` 24 hex, `__v`, `createdAt/updatedAt`) → ຄາດວ່າ Node.js + Express/NestJS + Mongoose |
| Realtime | `websocketService` (Socket.IO) ສຳລັບອໍເດີ/ໂຕະ/ຄົວ ແບບ realtime |
| ເຄື່ອງພິມ | **Local Print Agent** ແລ່ນຢູ່ເຄື່ອງ `localhost:9150` (`/api/v1/health`), browser ສົ່ງງານພິມໄປທີ່ agent; ມີ print dedup (`printDedup.recentPrints.v1`) ກັນພິມຊ້ຳ |
| ຈໍລູກຄ້າ | CFD (Customer-Facing Display) ຜ່ານ BroadcastChannel/heartbeat (`customerDisplay_*`) |
| ອື່ນໆ | ມີ Supplier portal ແຍກ (`appzap_supplier_*` token), Market/marketplace, eTax (ໃບກຳກັບພາສີອີເລັກໂຕຣນິກ) |

**ໂຄງສ້າງ URL:** `/restaurant/:restaurantId/branch/:branchId/<module>` → ທຸກໜ້າຜູກກັບ ຮ້ານ + ສາຂາ.

---

## 2. ໂມເດວ Multi-tenant (ສຳຄັນທີ່ສຸດ)

```
Owner (User)
 └─ Restaurant (ຮ້ານ / ແບຣນ)  ← settings ລະດັບຮ້ານ, package/subscription, ເມນູກາງ (Central)
     ├─ Branch (ສາຂາ)          ← settings ລະດັບສາຂາ + "overrides" (useRestaurantSettings: true/false)
     │   ├─ Tables / Zones / Table sessions / QR
     │   ├─ Staff (role + permissions + PIN)
     │   ├─ Inventory / Warehouse
     │   ├─ Shift definitions / Shift sessions
     │   └─ Printers / Terminals
     └─ Menu (itemLevel: Central | Branch, enabledBranches/disabledBranches, branchSpecificPricing)
```

- ທຸກການຕັ້ງຄ່າມີ **2 ຊັ້ນ**: ຄ່າຂອງຮ້ານ ແລະ ສາຂາ override ໄດ້ (`overrides.currency`, `taxSettings`, `paymentSettings`, `receipt`, `menuAvailability`...).
- **Package limits:** `maxBranches, maxUsers, maxProducts, maxTables, maxOrders`, level, startDate/endDate, autoRenew.
- **Feature flags ຕໍ່ສາຂາ** (`featureAccess`): ticket, attendance, customers, debts, employees, end_of_day, ingredients, inventory, kitchen_display, market, menu, orders, promotions, quick_orders, recipes, reports, settings, shifts, tables, transactions → ເປີດ/ປິດໂມດູນຕາມແພັກເກດ.

---

## 3. ແຜນຜັງເມນູ (Sidebar) ແລະ ໜ້າທີ່ຂອງແຕ່ລະໂມດູນ

### ກຸ່ມຫຼັກ
| ເມນູ | Route | ຟັງຊັນຫຼັກ |
|---|---|---|
| Branches | `/branches` | ພາບລວມທຸກສາຂາ: ລາຍຮັບ, ອໍເດີ, POS vs Online sales, ປຽບທຽບສາຂາ, **Leakage** (ພະນັກງານຍົກເລີກ/void/refund), ເພີ່ມສາຂາ |
| Dashboard | `/dashboard` | ລາຍງານປະຈຳວັນ: ຍອດຂາຍ, ຈຳນວນບິນ+ສະເລ່ຍ, ໂຕະຍັງບໍ່ຈ່າຍ, ຍົກເລີກ, ເງິນສົດ/ໂອນ, **ເງິນໃນລິ້ນຊັກຄວນມີ**, VAT/Service, Top items, ຍອດຕາມຊົ່ວໂມງ, Heatmap 7ມື້×ຊົ່ວໂມງ, ຕາມໝວດ, ຕາມພະນັກງານ, Trend 30 ມື້, ລາຍການໂຕະທີ່ຍັງບໍ່ຈ່າຍກ່ອນປິດຮ້ານ, ພິມສະຫຼຸບປິດວັນ |
| Cafe (Quick Order) | `/quick-orders` | POS ໜ້າຮ້ານແບບ takeaway/counter: ກິດຕາມໝວດ (category pills), ກາດສິນຄ້າ, ເພີ່ມລູກຄ້າ, Promotions/Discounts/Coupon, **Hold Order**, Checkout |
| Tables | `/tables` | ແຜນໂຕະ: ກັ່ນຕອງ All/Available/Occupied/Reserved/Edit/Bill Printed/Paid in app, Zone, ການຈອງ, "ຈ່າຍຜ່ານມືຖື". ກົດໂຕະ → Panel ຂວາ |
| Orders | `/orders` | ຄິວຄົວ/ລາຍການອາຫານຕາມສະຖານະ (ແບບ KDS): Pending → Confirmed → Preparing → Ready → Served / Paid / Cancelled; ແຍກ Table / Queue / Counter QR; ເລືອກຫຼາຍລາຍການເພື່ອປ່ຽນສະຖານະ, ພິມໃບຄົວ |
| Transactions | `/transactions` | ປະຫວັດການຊຳລະ: Total expected/Collected/Outstanding, ໜີ້, VAT+Service, ແຍກຕາມວິທີຈ່າຍ; ແທັບ All/Regular/Delivery/Debt/Cancelled; ພິມລາຍງານ, Export |

### ກຸ່ມ Operations
| ເມນູ | Route | ຟັງຊັນຫຼັກ |
|---|---|---|
| Table Management | `/table-management` | ຕັ້ງຄ່າໂຕະ, Zones, **QR Stickers** (permanent QR), Bulk Add / Single, ປະເພດໂຕະ Standard / **Time-based** (ຄິດເງິນຕາມເວລາ ເຊັ່ນ ສະນຸກ/ຄາລາໂອເກະ) |
| Menu | `/menu` | ແທັບ: Items, Categories, Customizations, Options, Menu sets. Import, **Copy to branches**, ສະແດງ Cost / Profit margin / Track inventory |
| Inventory | `/inventory` | Stock, Daily summary, Low stock, ຕັ້ງລະດັບວັດຖຸດິບ, History, Match suppliers, **Procurement** (ສັ່ງຊື້), **Production** (ຜະລິດ), Print stock, Export Excel |
| Beer Deposit | `/deposits` | **ຝາກເບຍ** (ລູກຄ້າຝາກເຫຼືອໄວ້ດື່ມຄັ້ງໜ້າ): ເລກໃບຝາກ, ລູກຄ້າ, ວັນໝົດອາຍຸ, ພິມໃບຊ້ຳ, ສະຕັອກທີ່ຖືໄວ້ |
| Ingredients | `/ingredients` | ວັດຖຸດິບ + ໝວດ, ຫົວໜ່ວຍ, ຕົ້ນທຶນ, track inventory |
| Recipes | `/recipes` | ສູດອາຫານ (BOM) → ຄິດຕົ້ນທຶນອັດຕະໂນມັດ, % ເມນູທີ່ມີສູດ, Grid/List |
| Employees | `/employees` | ພະນັກງານ, Role, ກະວຽກວັນນີ້, ສະຖານະ |
| Promotions | `/promotions` | ສ້າງໂປຣ, ສະຖິຕິ (ໃຊ້ຈັກເທື່ອ, ສ່ວນຫຼຸດລວມ), ສະຖານະ Active/Inactive/Expired/Draft |
| Customers | `/customers` | CRM: Import/Export, Loyalty program, tiers, ກັ່ນຕອງຕາມສາຂາ |
| Debts | `/debts` | ລູກໜີ້ (ຊື້ກ່ອນຈ່າຍທີຫຼັງ), ຍອດຄ້າງ, ການຊຳລະຄືນ |
| Shifts | `/shifts` | Shift definitions, Staff assignments, Shift sessions; ເປີດ/ປິດກະ, **ເງິນທອນຕັ້ງຕົ້ນ / ເງິນສົດຮັບ / ຄາດວ່າໃນລິ້ນຊັກ**, ໂອນໂຕະທີ່ຍັງເປີດໄປກະໃໝ່ (carry over) |
| Attendance | `/time-clock` | Check-in / Check-out ພະນັກງານຕາມກະ |
| Market | `/market` | Marketplace ຂອງ AppZap (ຊື້ວັດຖຸດິບ/ອຸປະກອນ ຈາກ supplier) |

### ກຸ່ມ Reports & Settings
| ເມນູ | ລາຍລະອຽດ |
|---|---|
| Reports | Sales (Unified: Summary/Category/Staff/Payment/Hourly/Daily), Income & Expense, Delivery report, Finance (P&L), Menu item sales, Inventory usage, Customer analytics, Promotion usage, Shop Wallet, Tax invoices (eTax), Staff attendance, Summary by branch |
| Shop Wallet | ເງິນຈາກຄູປອງ/ບິນອອນລາຍທີ່ລໍຖອນຈາກ AppZap (settlement) |
| Settings | ເບິ່ງຂໍ້ 7 |

---

## 4. Flow ການເຮັດວຽກຫຼັກ

### 4.1 Dine-in (ໂຕະ)
```
ກົດໂຕະວ່າງ → ເປີດ Table Session (startTime, staff)
  → Add ລາຍການ → Order (status: pending/confirmed) → ພິມໃບຄົວ (auto ຫຼື manual)
  → ຄົວ: preparing → ready → served   (realtime ຜ່ານ websocket)
  → Panel ໂຕະ: Customer | Print Bill | Transfer | Print Kitchen | Discount | Promotion | Coupon | Add | Checkout
  → Print Bill (ຖ້າ lockOrderAfterBillPrint=true → ລັອກບໍ່ໃຫ້ເພີ່ມ)
  → Checkout → Transaction → ປິດ Session, ໂຕະກັບເປັນ available
```
- ລູກຄ້າສັ່ງເອງຜ່ານ **QR ໂຕະ** (`qr-sessions`, permanentQr token) ແລະ ຈ່າຍຜ່ານແອັບ (AppZap Pay).
- ຮອງຮັບ **ລວມໂຕະ** (`mergeInfo`, `combinedWith`), **ຍ້າຍໂຕະ**, **ແຍກບິນ** (`splitBill`, `amountSplit`, `partialPayment`).
- ໂຕະ **Time-based**: hourlyRate, minimumMinutes, roundingRule, ratePeriods, pause/stop.

### 4.2 Quick order / Takeaway
ກາດ → Promotions/Discount/Coupon → Hold Order (ພັກບິນ) ຫຼື Checkout → ເລກຄິວ (`currentQNumber` ໃນ shift session) → ພິມໃບບິນ/ໃບຄົວ/**ສະຕິກເກີຈອກ**.

### 4.3 Checkout
- 2 ໂໝດ: **Standard Payment** ແລະ **Multiple Methods** (ຈ່າຍຫຼາຍວິທີໃນບິນດຽວ).
- ວິທີຈ່າຍ: Cash, Bank Transfer, Delivery, Bank QR, Points, Outstanding Balance (ໜີ້), Card, Mobile, Gift Card.
- ຫຼາຍສະກຸນເງິນ: LAK / USD (+THB ໄດ້) ມີອັດຕາແລກປ່ຽນ, ປຸ່ມຕົວເລກ, ເງິນທອນ, Tips.
- ປຸ່ມ: Complete Payment / Complete & Print Receipt.

### 4.4 ກະວຽກ ແລະ ລິ້ນຊັກເງິນ
Shift session ເກັບ: openingCashCount (ແຍກແບ໊ງ/ຫຼຽນ), closingCashCount + variance, summary (gross/net/tax/fees/tips/void/refund, paymentMethods, hourlyBreakdown), handover (ອໍເດີທີ່ຍັງເປີດຕອນປິດກະ), audit history.

### 4.5 ສາງ ແລະ ຕົ້ນທຶນ
Menu item ↔ Inventory item (ສິນຄ້າສຳເລັດຮູບ ເຊັ່ນ ນ້ຳດື່ມ) ຫຼື Menu item → Recipe → Ingredients → Inventory (ຕັດສະຕັອກຕາມສູດ). Costing: average/standard/last purchase, lot tracking, expiry, reorder point, supplier lead time.

---

## 5. Data Model (ອ່ານຈາກ API response)

### Restaurant
`name, code, description, ownerId, subscriptionId, cuisine[], tags[], address, contactInfo, packageInfo{features{maxBranches,maxUsers,maxProducts,maxTables,maxOrders}, level, startDate, endDate, autoRenew, paymentStatus}, settings{currency, taxSettings{vat, serviceCharge, otherTaxes}, etaxSettings, ordering, reports{dayStartTime}, shifts{openTableHandover}, receiptSettings{receipt,kitchen,qrMenu}, timezone, language, orderNumberPrefix/Suffix/Sequence, billNumberPrefix/Suffix/Sequence, enableTips, tipOptions, maxDiscountPercentage, requireDiscountReason, trackInventory, lowStockThreshold, preventSaleIfOutOfStock, requireStaffPin...}, enhancedBusinessHours, serviceOptions{dineIn, pickup, delivery, reservation}, digitalServices{qrMenu, mobileOrdering, customerChat, songRequest, feedback, loyaltyProgram, giftCards, waitlist, mobilePayment}, paymentSettings{acceptedPaymentMethods, processingFees, splitBill, cashDrawer, qrPayment}, notificationSettings, kitchenManagement{kds{stations}}, languageSettings, webhooks[]`

### Branch
`name, restaurantId, branchCode, branchType, isActive, images[], tablePanel{add, addCustomer, checkout, discount, orderQuantity, printBill, printKitchen, printKitchenCancel, promotion, transfer}, settings{openingHours, orderCreation{staff,customer,thirdParty → requiresConfirmation, autoConfirmTimeout}, autoKitchenPrinting, takeawayPrinting{printReceipt, printKitchenTicket, printStickerLabels}, security{pinFeatures{adjustTransaction, applyDiscount, cancelItem, closeTable, voidTransaction}, pinEnabled}, theme, overrides{...}, partialPayment, qrTablePay, qrTakeaway, viewOnlyMode, featureAccess{...}, billPrinting{lockOrderAfterBillPrint, previewBillBeforePrint}, isDineIn/Takeout/DeliveryAvailable, currency, taxRate, serviceChargeRate, shiftsEnabled}, inheritsCentralMenu, warehouseV2EnabledAt`

### Table / Zone / Session
- **Table:** `name, displayOrder, capacity, min/maxCapacity, shape, size{w,h,radius}, position{x,y,rotation}` (ແຜນຜັງ floor plan), `status, tableType(standard|time_based), permanentQr{enabled, token}, timeBasedConfig{hourlyRate, minimumMinutes, roundingRule, ratePeriods}, combinedWith[], currentSessionId, currentReservationId, currentQrSessionId`
- **TableSession:** `tableSessionId, tableId, status, startTime, timeCharge{...}, mergeInfo, amountSplit, billPrinting, editingTransactionId`
- **Session summary:** `orders[], sessionDiscounts[], payments[], financialSummary{baseSubtotal, baseTax, baseFees, baseTip, timeChargeAmount, discount, finalSubtotal, finalTax, finalFees, finalTotal...}`
- **TableReservation, TableZone**

### Menu
- **MenuCategory:** `name, itemLevel(central|branch), parentCategoryId (ໝວດຍ່ອຍ), displayOrder, discount{daysOfWeek, discountType, discountValue, timeStart, timeEnd, minimumOrderValue, maximumDiscountAmount}, availability{availableDays, alwaysAvailable}`
- **MenuItem:** `name, itemLevel, overrideFields[], categoryId, additionalCategories[], itemCode, barcode, unit, pricing{basePrice, taxRate, taxIncluded, currency, multiCurrencyPrices, discount, priceHistory}, isActive, isRecommended, isFeatured, isNewItem, isBestseller, availability, preparationTime, allergens[], dietary{isVegetarian, isVegan, isHalal, containsPork, containsAlcohol...}, customizations[], relatedItems[], isCombo, comboDetails, inventory{trackInventory}, images[], enabledBranches[], disabledBranches[], version, previousVersions[]` + ຂາຍຕາມນ້ຳໜັກ (ລາຄາ/kg), ແປພາສາ
- **Customization / Option (modifiers), MenuSet (combo)**

### Order / Transaction
- **Order:** ສະຖານະ `pending → confirmed → preparing → ready → served → paid | cancelled`, ແຫຼ່ງ `staff | customer | third-party`, ປະເພດ `dine-in | takeaway | delivery`, ເລກຄິວ
- **Transaction:** summary `totalTxnCount, salesCount, voidCount, salesAmount, voidAmount, totalVat, totalServiceCharge, totalTenderedAmount, totalChangeGiven, totalTipAmount, paymentMethodBreakdown[], bankTransferBreakdown[], currencyBreakdown[]`, ມີ `shiftLock`
- **CancelledItems**, **Expenses** (ລາຍຈ່າຍ), **Debts / DebtTransactions**

### Inventory
- **InventoryItem:** `itemId, itemType(menu_item|ingredient), sku, primaryUnit{name, abbreviation, baseConversionFactor, precision}, trackingMethod, costingMethod, totalStock, reservedStock, availableStock, allowNegativeStock, lowStockThreshold, maxStockLevel, reorderPoint, reorderQuantity, supplierLeadTimeDays, standardCost, averageCost, lastPurchaseCost, totalStockValue, hasExpiryDate, expiryWarningDays, lotTracked, storageConditions, supplierLink{unitPrice, conversionFactor}`
- **Ingredient:** `categoryId, unit, cost{purchasePrice, averageCost, lastPurchasePrice}, suppliers[], storage{temperature, shelfLife}, conversionFactors[], costHistory[]`
- **Recipe:** `ingredients[], preparationSteps[], cookingSteps[], yieldQuantity, yieldUnit, costDetails{totalCost, ingredientCosts, complete}, version`
- **Warehouse** (ສາງກາງ), Procurement (PO), Production, Deposits (ຝາກເບຍ)

### Staff / HR
`name, userId, phone, role, customRoleId, permissions[], revokedPermissions[], hasPIN, hasPasscode, isOwner, financialInfo{salary, hourlyRate, dailyRate, paymentFrequency, overtimeMultiplier, taxWithholding...}, employmentDetails{startDate, contractType, position, department}, attendanceTracking, performanceReviews[]` + ShiftDefinition (`code, startTime, endTime, isOvernight, dayOfWeek[], color`), StaffShiftAssignment, TimeEntries.

### CRM / Marketing
Customers (lifecycle, loyaltyTier), LoyaltyPrograms (pointsPerCurrency, tiers, birthday/referral bonus, expiry), Promotions, Coupons, Gift cards.

---

## 6. ລາຍການ API Endpoints ທີ່ພົບ (`/api/v1`)

```
Auth/Org     GET  /my-permissions
             GET  /restaurants/:id            GET /restaurants/:id/settings/{currency,etax}
             GET  /branches/:id               GET /branches/restaurant/:restaurantId   GET /branches/deleted
             GET  /branches/:id/{printers,feature-access}
             GET  /branches/:id/settings/{security,delivery-providers,notifications,receipt,tax}
Tables       GET  /tables  /table-zones  /table-reservations  /table-sessions/editing/list
             GET  /qr-sessions/permanent-pickup/active
Orders       GET  /orders  /orders/cancelled-items  /orders/table-order/session/:id/summary
Payments     GET  /transactions  /appzap-settlements/summary  /restaurants/:id/payment...
             GET  /debts  /debts/summary  /debts/transactions  /expenses
Shifts       GET  /shift-definitions  /shift-sessions/current  /shift-sessions/open-orders-summary
             GET  /staff-shift-assignments  /staff-shift-assignments/assigned-shift
             GET  /time-tracking/status/:staffId  /time-tracking/entries/:staffId
Menu         GET  /menu-categories  /menu-items  /menu-sets
Inventory    GET  /inventory/items  /warehouse  /ingredients  /ingredient-categories
             GET  /ingredients/pending-activations  /recipes  /recipe-categories
             GET  /deposits  /deposits/beer-stock
Staff        GET  /staffs/branch/:id
CRM/Promo    GET  /crm/customers  /crm/loyalty-programs  /crm/analytics/insights/:id
             GET  /promotions  /promotions/stats
Reports      GET  /reports/sales-summary-enhanced  /reports/sales-by-category  /reports/sales-by-employee
             GET  /reports/sales-items-report  /reports/analytics/:rid/:bid/summary
             GET  /reports/branch-comparison  /reports/leakage-by-staff  /reports/coupon-claims/:id
Other        GET  /tickets/config  /tickets/stats  /delivery/drivers/available  /market/showcase/popups
Local agent  GET  http://localhost:9150/api/v1/health   (print agent)
```
ຮູບແບບ response ບໍ່ສະໝ່ຳສະເໝີ (ບາງອັນ `{success,data,pagination}`, ບາງອັນ `{results,page,limit,totalResults}`, ບາງອັນສົ່ງ array ກົງໆ) → ລະບົບໃໝ່ຄວນກຳນົດມາດຕະຖານດຽວ.

---

## 7. ການຕັ້ງຄ່າ (Branch Settings)

| ກຸ່ມ | ໜ້າ | ລາຍລະອຽດ |
|---|---|---|
| Restaurant | General | ຂໍ້ມູນສາຂາ, ໂລໂກ້ໃບບິນ, ທີ່ຢູ່ + lat/lng, **Table Panel** ເປີດ/ປິດປຸ່ມແຕ່ລະອັນ |
| | Hours & location | ເວລາເປີດ-ປິດ, ແຜນທີ່ (ໃຫ້ລູກຄ້າໃນແອັບຊອກເຫັນ) |
| | Security | PIN ສຳລັບ ສ່ວນຫຼຸດ / void / ຍົກເລີກລາຍການ / ປິດໂຕະ / ແກ້ທຸລະກຳ |
| Financial | Currency | ສະກຸນຫຼັກ, ສະກຸນທີ່ຮັບ, ອັດຕາແລກປ່ຽນ + ປະຫວັດ, rounding, ຮູບແບບຕົວເລກ |
| | Tax | VAT (ລວມໃນລາຄາ/ບໍ່, ຍົກເວັ້ນໝວດ/ລາຍການ), Service charge (ແບ່ງໃຫ້ພະນັກງານ), ພາສີອື່ນ |
| | Payment | AppZap Pay (QR ຈ່າຍຈາກໂທລະສັບ) ຕໍ່ dine-in/takeaway/delivery, ຄ່າທຳນຽມ |
| | Banks | ບັນຊີທະນາຄານສຳລັບໂອນ |
| | Delivery Providers | ແພລັດຟອມສົ່ງອາຫານ (ລາຄາຕ່າງຫາກ) |
| | Audit Log | ບັນທຶກທຸກເຫດການເງິນ ແລະ ອໍເດີ |
| Operations | Printers | ຈັດການເຄື່ອງພິມຕໍ່ Terminal, Order creation (auto-confirm ຕາມແຫຼ່ງ), Auto kitchen printing, Takeaway printing (ບິນ/ໃບຄົວ/ສະຕິກເກີ) |
| | CFD | ຈໍສະແດງໃຫ້ລູກຄ້າ |
| | Receipt | Template ໃບບິນ / ໃບຄົວ / QR menu, header/footer, ອັດຕາແລກປ່ຽນ, ຫຼາຍສະກຸນ, QR ຈ່າຍເງິນ, 58/80mm, Live preview |
| | Notifications | ສຽງແຈ້ງເຕືອນອໍເດີ/ຈ່າຍເງິນ/ຄົວ, quiet hours |
| | QR Settings | Smart Menu (ເບິ່ງຢ່າງດຽວ) / Takeaway QR |
| | Store Theme | ສີ ແລະ ໜ້າຕາໜ້າສັ່ງຜ່ານ QR |
| | Ordering | ຮູບແບບແຖບໝວດໃນໜ້າ Quick Order |
| | Ticket | ຫົວໃບ, ລາຄາ, ສີ (ລະບົບປີ້/ຄູປອງ) |

---

## 8. ຈຸດອ່ອນທີ່ສັງເກດເຫັນ → ໂອກາດເຮັດໃຫ້ດີກວ່າ

1. **ກະວຽກບໍ່ຖືກປິດ**: ກະ "All Day" ເປີດຄ້າງ 7,518 ຊົ່ວໂມງ (ຕັ້ງແຕ່ 13/01/2026) ແລະໂຕະເປີດຄ້າງ 3 ເດືອນ → ລະບົບໃໝ່ຄວນມີ **auto day-close / ແຈ້ງເຕືອນບັງຄັບປິດກະ** ແລະ ບັງຄັບນັບເງິນລິ້ນຊັກ.
2. **Dashboard ສະແດງ 0** ເຖິງວ່າມີເງິນສົດ ₭4.9M ໃນກະ → ການແບ່ງ "ວັນທຸລະກິດ" ກັບ "ກະ" ສັບສົນ. ໃຊ້ `businessDate` ທີ່ຊັດເຈນ (ອີງ dayStartTime).
3. **Response format ບໍ່ສະໝ່ຳສະເໝີ** → ກຳນົດ envelope ດຽວ + OpenAPI spec.
4. **Token ເກັບໃນ localStorage** (ສ່ຽງ XSS) → ໃຊ້ httpOnly cookie ຫຼື token ອາຍຸສັ້ນ + rotation.
5. **ໃຊ້ໄດ້ສະເພາະອອນລາຍ** → ລະບົບໃໝ່ຄວນ **Offline-first** (IndexedDB/SQLite + sync queue) ເພາະອິນເຕີເນັດລາວບໍ່ໝັ້ນຄົງ.
6. **ຮູບອາຫານເປັນ placeholder** ເປັນສ່ວນໃຫຍ່, ສູດອາຫານມີພຽງ 0/26 → ຕ້ອງມີ **onboarding wizard** (ນຳເຂົ້າ Excel, ສ້າງສູດໄວ, ແນະນຳຂັ້ນຕອນ).
7. ພາສາປົນ ລາວ/ອັງກິດ ໃນ UI ດຽວກັນ → i18n ຄົບ 100%.
8. ຍັງບໍ່ມີ KDS ແຍກຈໍ (ມີແຕ່ flag `kitchen_display`), stations ຂອງຄົວ.

---

## 9. ຂໍ້ສະເໜີ: ລະບົບໃໝ່ "ສົມບູນທີ່ສຸດ"

### 9.1 ສະຖາປັດຕະຍະກຳທີ່ແນະນຳ
| ຊັ້ນ | ເລືອກ |
|---|---|
| Frontend POS | React + TypeScript + Vite + Tailwind + Zustand + TanStack Query; **PWA offline-first** (Dexie/IndexedDB); ສາມາດຫໍ່ເປັນ Electron/Tauri (Windows) ແລະ Capacitor (Android tablet) |
| Backend | Node.js (NestJS) + TypeScript, REST + WebSocket (Socket.IO) |
| Database | PostgreSQL (ທຸລະກຳເງິນຕ້ອງການ ACID ດີກວ່າ MongoDB) + Redis (cache, queue, realtime pub/sub) |
| ເຄື່ອງພິມ | Local Print Agent (Node/Go) ຮອງຮັບ ESC/POS LAN/USB/Bluetooth, queue + retry + dedup |
| ລູກຄ້າ | QR Menu web app (Next.js), CFD, KDS ເປັນ app ແຍກ |
| Infra | Docker, S3-compatible storage ສຳລັບຮູບ, background jobs (BullMQ) ສຳລັບລາຍງານ/ປິດວັນ |

### 9.2 ໂມດູນ (ຄົບທຸກອັນຂອງ AppZap + ເພີ່ມ)
**ເອົາມາທັງໝົດ:** Multi-branch, Dashboard, Quick order, Tables + floor plan, Orders/KDS, Transactions, Table mgmt + QR, Menu (central/branch, modifiers, combo, ຫຼາຍພາສາ, ຂາຍຕາມນ້ຳໜັກ), Inventory + Procurement + Production, Ingredients + Recipes (BOM), Beer deposit, Employees + Roles + PIN, Promotions/Coupons, CRM + Loyalty, Debts, Shifts + Cash drawer, Attendance, Reports ທັງໝົດ, Audit log, ຫຼາຍສະກຸນເງິນ, VAT/Service charge, eTax.

**ເພີ່ມເພື່ອໃຫ້ເໜືອກວ່າ:**
1. Offline mode ເຕັມຮູບແບບ + sync conflict resolution
2. KDS ຈໍຄົວ ແຍກ station (ຄົວຮ້ອນ / ບາ / ເຄື່ອງດື່ມ) + ຈັບເວລາ + ສຽງເຕືອນ
3. ປິດວັນອັດຕະໂນມັດ (End-of-Day wizard): ກວດໂຕະຄ້າງ → ນັບເງິນ → ສົ່ງລາຍງານ Telegram/WhatsApp/LINE ໃຫ້ເຈົ້າຂອງ
4. ແຈ້ງເຕືອນ Leakage realtime (void/ຍົກເລີກ/ສ່ວນຫຼຸດຜິດປົກກະຕິ) ໄປຫາເຈົ້າຂອງ
5. Floor plan ແບບລາກວາງ (ໃຊ້ position/shape ທີ່ມີໃນ model)
6. ຈອງໂຕະອອນລາຍ + waitlist
7. ການເຊື່ອມ QR ທະນາຄານລາວ (BCEL OnePay, LDB, JDB...) ກວດສອບການໂອນອັດຕະໂນມັດ
8. Owner mobile app (ເບິ່ງຍອດຂາຍທຸກສາຂາ realtime)
9. AI: ຄາດຄະເນສະຕັອກ, ແນະນຳສັ່ງຊື້, ວິເຄາະເມນູ (menu engineering: Star/Plow-horse/Puzzle/Dog)
10. Onboarding wizard + import Excel ເມນູ/ວັດຖຸດິບ/ສູດ
11. Role/Permission ລະອຽດລະດັບ action + PIN override ໂດຍຜູ້ຈັດການ
12. Public API + Webhooks ສຳລັບ delivery platforms (foodpanda/LOCA/...)

### 9.3 Roadmap ແນະນຳ
| Phase | ເນື້ອໃນ |
|---|---|
| 1 – MVP (Core POS) | Auth/Roles, Restaurant/Branch, Menu+Categories+Modifiers, Tables+Zones, Dine-in & Quick order, Checkout (cash/transfer/QR, LAK/USD/THB), ພິມໃບບິນ+ໃບຄົວ, Shift+Cash drawer, Dashboard ປະຈຳວັນ |
| 2 – Operations | KDS, QR self-order, Inventory + Ingredients + Recipes, Promotions/Discounts, Debts, Transactions report, Audit log, Offline mode |
| 3 – Growth | CRM + Loyalty, Reservations, Beer deposit, Procurement/Suppliers, Multi-branch report + Leakage, Owner app, eTax |
| 4 – Advanced | Delivery integration, AI analytics, Marketplace, Public API/Webhooks, Time-based tables |

---

### ໝາຍເຫດການສຶກສາ
- ສຶກສາແບບອ່ານຢ່າງດຽວ: ເປີດຟອມ Checkout ແລະ Add Item ເພື່ອເບິ່ງຊ່ອງຂໍ້ມູນ ແລ້ວກົດ Cancel/Close; ບໍ່ມີການບັນທຶກ, ຊຳລະ ຫຼື ລຶບຂໍ້ມູນໃດໆ.
- ບໍ່ໄດ້ເກັບ token, ລະຫັດຜ່ານ ຫຼື ຂໍ້ມູນສ່ວນຕົວຂອງລູກຄ້າ; ເກັບສະເພາະຊື່ field ແລະ ປະເພດຂໍ້ມູນ.
- ໃຊ້ເອກະສານນີ້ເປັນແນວທາງອອກແບບ; ໂຄດ, ຮູບ ແລະ ແບຣນຂອງລະບົບໃໝ່ຄວນສ້າງຂຶ້ນເອງທັງໝົດ.
