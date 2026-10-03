import type { ReactNode } from 'react';

export function Card({ title, icon, right, children, className = '' }: {
  title?: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 md:p-6 ${className}`}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {icon}{title}
          </h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export const Label = ({ children }: { children: ReactNode }) => (
  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{children}</span>
);
