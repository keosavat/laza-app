import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { get, post, put, type Role, type StaffUser } from '../lib/api';
import { useSession } from '../lib/store';
import { dateTime, ROLE_LABEL } from '../lib/format';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, useAction, useLoad } from '../components/ui';

const ROLE_HINT: Record<Role, string> = {
  owner: 'ທຸກຢ່າງ',
  manager: 'ທຸກຢ່າງ (ຍົກເວັ້ນຕັ້ງສິດເຈົ້າຂອງ)',
  cashier: 'ຂາຍ, ຮັບເງິນ, ສ່ວນຫຼຸດ, ກະ, ລາຍງານ',
  waiter: 'ເປີດໂຕະ, ສັ່ງອາຫານ, ພິມບິນ',
  kitchen: 'ຈໍຄົວເທົ່ານັ້ນ',
};

export default function Staff() {
  const me = useSession((s) => s.user!);
  const [users, reload, loading] = useLoad(() => get<StaffUser[]>('/users'));
  const [edit, setEdit] = useState<Partial<StaffUser> | null>(null);

  if (loading || !users) return <Spinner />;
  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="ພະນັກງານ"
        sub={`${users.filter((u) => u.active).length} ຄົນທີ່ໃຊ້ງານຢູ່`}
        actions={
          <Button onClick={() => setEdit({ name: '', username: '', role: 'waiter', active: 1 })}>
            <Plus className="size-4" /> ພະນັກງານໃໝ່
          </Button>
        }
      />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">ຊື່</th>
              <th className="px-4 py-2 font-medium">ຊື່ຜູ້ໃຊ້</th>
              <th className="px-4 py-2 font-medium">ໜ້າທີ່</th>
              <th className="px-4 py-2 font-medium">ສະຖານະ</th>
              <th className="px-4 py-2 font-medium">ສ້າງເມື່ອ</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2.5 font-medium">{u.name}{u.id === me.uid && <span className="ml-1 text-xs text-slate-400">(ທ່ານ)</span>}</td>
                <td className="px-4 py-2.5 text-slate-600">{u.username}</td>
                <td className="px-4 py-2.5">{ROLE_LABEL[u.role]}</td>
                <td className="px-4 py-2.5">
                  <Badge className={u.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}>{u.active ? 'ໃຊ້ງານ' : 'ປິດ'}</Badge>
                </td>
                <td className="px-4 py-2.5 text-slate-500">{dateTime(u.created_at)}</td>
                <td className="px-4 py-2.5 text-right">
                  {(u.role !== 'owner' || me.role === 'owner') && (
                    <button onClick={() => setEdit(u)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label="ແກ້ໄຂ">
                      <Pencil className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {edit && <UserModal user={edit} self={edit.id === me.uid} isOwner={me.role === 'owner'} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}

function UserModal({ user, self, isOwner, onClose, onSaved }: { user: Partial<StaffUser>; self: boolean; isOwner: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(user.name ?? '');
  const [username, setUsername] = useState(user.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(user.role ?? 'waiter');
  const [active, setActive] = useState(user.active !== 0);
  const { busy, run } = useAction();
  const roles = (Object.keys(ROLE_LABEL) as Role[]).filter((r) => r !== 'owner' || isOwner);

  const save = async () => {
    const body = user.id ? { name, role, active, ...(password ? { password } : {}) } : { name, username, password, role };
    if (await run(() => (user.id ? put(`/users/${user.id}`, body) : post('/users', body)), 'ບັນທຶກແລ້ວ')) {
      onSaved();
      onClose();
    }
  };

  return (
    <Modal open onClose={onClose} title={user.id ? `ແກ້ໄຂ: ${user.name}` : 'ພະນັກງານໃໝ່'} footer={<Button onClick={save} loading={busy}>ບັນທຶກ</Button>}>
      <div className="space-y-4">
        <Field label="ຊື່ ແລະ ນາມສະກຸນ">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
        </Field>
        <Field label="ຊື່ຜູ້ໃຊ້ (ສຳລັບເຂົ້າລະບົບ)" hint={user.id ? 'ປ່ຽນບໍ່ໄດ້' : 'a-z, 0-9, . _ - ຢ່າງໜ້ອຍ 3 ຕົວ'}>
          <Input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} disabled={!!user.id} autoComplete="off" />
        </Field>
        <Field label={user.id ? 'ລະຫັດຜ່ານໃໝ່ (ປ່ອຍວ່າງຖ້າບໍ່ປ່ຽນ)' : 'ລະຫັດຜ່ານ'} hint="ຢ່າງໜ້ອຍ 6 ຕົວ">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="ໜ້າທີ່" hint={ROLE_HINT[role]}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={self}>
            {roles.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </Select>
        </Field>
        {user.id && !self && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-brand-600" /> ເປີດໃຊ້ງານບັນຊີນີ້
          </label>
        )}
      </div>
    </Modal>
  );
}
