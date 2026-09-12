export default function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="glass rounded-2xl px-5 py-4">
      <p className="text-xs text-text-muted uppercase tracking-wide">{label}</p>
      <p className="font-display font-semibold text-2xl mt-1.5 text-text-primary">
        {value}
      </p>
      {sub && <p className="text-xs text-text-secondary mt-1">{sub}</p>}
    </div>
  );
}
