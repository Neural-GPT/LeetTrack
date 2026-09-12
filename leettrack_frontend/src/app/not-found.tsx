import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="glass rounded-2xl p-8 max-w-md">
        <h2 className="text-lg font-semibold mb-2">Page not found</h2>
        <p className="text-[var(--color-text-secondary)] mb-4">
          That page doesn&apos;t exist, or may have moved.
        </p>
        <Link
          href="/"
          className="inline-block rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
