import { useState, type FormEvent } from 'react';
import { useSession } from '../lib/store';
import { Button, Field, Input, toast } from '../components/ui';

export default function Login() {
  const login = useSession((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      toast.err(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-brand-700 to-brand-900 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <img src="/laza.svg" alt="" className="size-12" />
          <span className="text-2xl font-bold">LAZA app</span>
        </div>
        <div>
          <h2 className="text-3xl font-bold leading-snug">ລະບົບຂາຍໜ້າຮ້ານ<br />ສຳລັບຮ້ານອາຫານ ແລະ ຄາເຟ່</h2>
          <p className="mt-3 text-brand-100">ໂຕະ · ສັ່ງອາຫານ · ຄົວ · ຊຳລະເງິນຫຼາຍສະກຸນ · ກະ ແລະ ລິ້ນຊັກເງິນ · ລາຍງານປະຈຳວັນ</p>
        </div>
        <div className="text-sm text-brand-200">© LAZA app</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div className="text-center lg:text-left">
            <img src="/laza.svg" alt="" className="mx-auto mb-3 size-14 lg:hidden" />
            <h1 className="text-2xl font-bold">ເຂົ້າສູ່ລະບົບ</h1>
            <p className="text-sm text-slate-500">ປ້ອນຊື່ຜູ້ໃຊ້ ແລະ ລະຫັດຜ່ານຂອງທ່ານ</p>
          </div>
          <Field label="ຊື່ຜູ້ໃຊ້">
            <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="ລະຫັດຜ່ານ">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            ເຂົ້າສູ່ລະບົບ
          </Button>
        </form>
      </div>
    </div>
  );
}
