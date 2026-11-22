// Per-device preferences (this browser only).
const read = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};
const write = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    /* ignore */
  }
};

export const device = {
  get autoKitchenPrint() { return read('laza_auto_kitchen_print', false); },
  set autoKitchenPrint(v: boolean) { write('laza_auto_kitchen_print', v); },
  get autoReceiptPrint() { return read('laza_auto_receipt_print', true); },
  set autoReceiptPrint(v: boolean) { write('laza_auto_receipt_print', v); },
};
