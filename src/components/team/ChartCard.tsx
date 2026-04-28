export function ChartCard({
  title,
  subtitle,
  children,
  loading,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  loading?: boolean
}) {
  return (
    <section className="bg-pennie-white rounded-3xl shadow-resting p-6 flex flex-col">
      <header className="mb-4">
        <p className="pennie-label">{title}</p>
        {subtitle && (
          <p className="text-xs text-pennie-graphite/60 mt-1">{subtitle}</p>
        )}
      </header>
      <div className="flex-1 min-h-[240px]">
        {loading ? (
          <div className="w-full h-[240px] rounded-2xl bg-pennie-beige/60 animate-pulse" />
        ) : (
          children
        )}
      </div>
    </section>
  )
}
