interface PanelHeaderProps {
  title: string
  children?: React.ReactNode
}

export function PanelHeader({ title, children }: PanelHeaderProps) {
  return (
    <div className="border-border bg-muted/30 flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
      <span className="text-foreground flex-1 truncate text-xs font-medium">{title}</span>
      {children}
    </div>
  )
}
