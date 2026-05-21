'use client'

import { X, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ColHeaderProps {
  children: React.ReactNode    // the filter widget
  hasValue: boolean
  onClear: () => void
  sortKey?: string
  currentSort?: string
  onSort?: () => void
  className?: string
}

export function ColHeader({ children, hasValue, onClear, sortKey, currentSort, onSort, className }: ColHeaderProps) {
  const isAsc  = sortKey ? currentSort === `${sortKey}_asc` : false
  // date defaults to desc when no sort is set
  const isDesc = sortKey ? (currentSort === `${sortKey}_desc` || (!currentSort && sortKey === 'date')) : false

  return (
    <div className={cn('flex items-center h-8 gap-0.5', className)}>
      {onSort && (
        <button
          onClick={onSort}
          className="shrink-0 h-6 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground focus:outline-none"
          tabIndex={-1}
        >
          {isAsc  ? <ArrowUp   className="h-3 w-3 text-primary" /> :
           isDesc ? <ArrowDown className="h-3 w-3 text-primary" /> :
                    <ArrowUpDown className="h-3 w-3 opacity-40" />}
        </button>
      )}
      <div className="flex-1 min-w-0 h-full flex items-center overflow-hidden">
        {children}
      </div>
      <button
        onClick={onClear}
        tabIndex={-1}
        className={cn(
          'shrink-0 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-opacity',
          hasValue ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}
