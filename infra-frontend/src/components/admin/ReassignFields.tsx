import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { deskLabel, DESK_ORDER } from '../../lib/ticketUi';
import type { ReassignValue } from '../../lib/reassign';

interface Staff { id: number; name: string; email: string; department: string; open_tickets: number; scope_match: boolean; on_leave: boolean }

const selectCls =
  'w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500';

/** Desk select + person select for the override forms. The list comes from /admin/staff, best match first. */
export default function ReassignFields({ department, campus, value, onChange }: {
  department?: string; campus?: string | null; value: ReassignValue; onChange: (v: ReassignValue) => void;
}) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!value.desk) { setStaff([]); return; }
    let live = true;
    setLoading(true);
    api.get('/admin/staff', { params: { role: value.desk, department, campus: campus ?? undefined } })
      .then((r) => { if (live) setStaff(r.data.staff ?? []); })
      .catch(() => { if (live) setStaff([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [value.desk, department, campus]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Reassign desk</label>
        <select value={value.desk} onChange={(e) => onChange({ desk: e.target.value, userId: '' })} className={selectCls}>
          <option value="">No change</option>
          {DESK_ORDER.map((d) => <option key={d} value={d}>{deskLabel(d)}</option>)}
        </select>
      </div>
      <div>
        <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Person</label>
        <select value={value.userId} disabled={!value.desk || loading} onChange={(e) => onChange({ ...value, userId: e.target.value })} className={selectCls}>
          <option value="">{!value.desk ? '—' : loading ? 'Loading…' : 'Choose a person'}</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.open_tickets} open{s.on_leave ? ' · on leave' : ''}{department && !s.scope_match && (value.desk === 'JE' || value.desk === 'AE') ? ' · outside scope' : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
