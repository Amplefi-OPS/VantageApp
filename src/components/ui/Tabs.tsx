import { cn } from '../../lib/utils'

interface TabsProps {
  tabs: { key: string; label: string; count?: number }[]
  active: string
  onChange: (key: string) => void
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 border-b border-light-gray overflow-x-auto" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={tab.key === active}
          onClick={() => onChange(tab.key)}
          className={cn(
            'px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px min-h-[44px]',
            tab.key === active
              ? 'border-slate-blue text-slate-blue'
              : 'border-transparent text-warm-gray hover:text-charcoal hover:border-light-gray',
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={cn(
                'ml-1.5 px-1.5 py-0.5 rounded-full text-xs',
                tab.key === active ? 'bg-slate-blue/10 text-slate-blue' : 'bg-light-gray text-warm-gray',
              )}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
