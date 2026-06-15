export default function PageHeader({ title, description, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 lg:mb-8 animate-fade-in-up">
      <div className="min-w-0">
        <h1 className="font-display text-2xl sm:text-[1.7rem] lg:text-[2rem] font-bold tracking-tight leading-tight">{title}</h1>
        {description && <p className="text-[13px] sm:text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap shrink-0">{children}</div>}
    </div>
  );
}
