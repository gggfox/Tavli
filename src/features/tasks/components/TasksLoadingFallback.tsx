/**
 * Loading placeholder for tasks section
 */
export function TasksLoadingFallback() {
  return (
    <div className="h-full flex flex-col justify-center px-6 py-8 max-w-2xl mx-auto">
      <div className="animate-pulse space-y-4">
        <div 
          className="h-20 rounded-xl" 
          style={{ backgroundColor: 'var(--bg-tertiary)' }} 
        />
        <div 
          className="h-12 rounded-lg" 
          style={{ backgroundColor: 'var(--bg-tertiary)' }} 
        />
        <div className="space-y-2">
          <div 
            className="h-16 rounded-lg" 
            style={{ backgroundColor: 'var(--bg-tertiary)' }} 
          />
          <div 
            className="h-16 rounded-lg" 
            style={{ backgroundColor: 'var(--bg-tertiary)' }} 
          />
        </div>
      </div>
    </div>
  )
}
