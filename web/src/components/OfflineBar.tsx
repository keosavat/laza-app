import { useState } from 'react';
import { CloudOff, Loader2, TriangleAlert, X } from 'lucide-react';
import { dismissFailed, flushQueue, useNet } from '../lib/offline';
import { time } from '../lib/format';
import { Button } from './ui';

/** Shows when the server cannot be reached, what is waiting to be sent, and what the server refused on replay. */
export default function OfflineBar() {
  const { online, queue, failed, flushing } = useNet();
  const [open, setOpen] = useState(false);
  if (online && !queue.length && !failed.length) return null;

  return (
    <div className="border-b border-slate-200 text-sm">
      {(!online || queue.length > 0) && (
        <div className={online ? 'bg-sky-50 text-sky-900' : 'bg-amber-100 text-amber-900'}>
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            {flushing ? <Loader2 className="size-4 animate-spin" /> : <CloudOff className="size-4" />}
            <span className="font-medium">
              {flushing ? 'ກຳລັງສົ່ງຂໍ້ມູນທີ່ເກັບໄວ້...' : online ? 'ມີຂໍ້ມູນລໍຖ້າສົ່ງ' : 'ເຊື່ອມຕໍ່ເຊີບເວີບໍ່ໄດ້'}
            </span>
            <span className="text-xs opacity-80">
              {!online && 'ກຳລັງລອງເຊື່ອມຕໍ່ໃໝ່ເອງ · ສະແດງຂໍ້ມູນຄັ້ງລ່າສຸດ · ຊຳລະເງິນ/ເປີດໂຕະໃໝ່ ຕ້ອງລໍເຊື່ອມຕໍ່ກ່ອນ'}
            </span>
            {queue.length > 0 && (
              <button onClick={() => setOpen(!open)} className="ml-auto rounded-full bg-white/70 px-3 py-0.5 text-xs font-semibold">
                ລໍຖ້າສົ່ງ {queue.length} {open ? '▲' : '▼'}
              </button>
            )}
            {online && queue.length > 0 && !flushing && (
              <Button size="sm" variant="secondary" onClick={() => flushQueue()}>ສົ່ງດຽວນີ້</Button>
            )}
          </div>
          {open && queue.length > 0 && (
            <ul className="space-y-0.5 border-t border-black/5 px-4 py-2 text-xs">
              {queue.map((q) => (
                <li key={q.key}>
                  {time(new Date(q.at).toISOString())} · {q.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {failed.length > 0 && (
        <div className="bg-rose-50 px-4 py-2 text-rose-900">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-4 shrink-0" />
            <span className="font-medium">ເຊີບເວີບໍ່ຮັບ {failed.length} ລາຍການທີ່ເກັບໄວ້ — ກວດ ແລະ ເຮັດໃໝ່ດ້ວຍມື</span>
            <button onClick={() => dismissFailed()} className="ml-auto text-xs underline">ລ້າງທັງໝົດ</button>
          </div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {failed.map((f) => (
              <li key={f.key} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  {f.label}: <b>{f.error}</b>
                </span>
                <button onClick={() => dismissFailed(f.key)} aria-label="ປິດ"><X className="size-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
