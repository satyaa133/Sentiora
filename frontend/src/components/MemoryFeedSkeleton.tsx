export default function MemoryFeedSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: 6 }).map((_, idx) => (
        <div
          key={idx}
          className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4 animate-pulse"
        >
          <div className="flex justify-between items-center">
            <div className="h-4 w-20 bg-slate-800 rounded-md" />
            <div className="h-4 w-12 bg-slate-800 rounded-md" />
          </div>
          <div className="h-5 w-3/4 bg-slate-800 rounded-md" />
          <div className="space-y-2">
            <div className="h-3 w-full bg-slate-800/60 rounded-md" />
            <div className="h-3 w-5/6 bg-slate-800/60 rounded-md" />
            <div className="h-3 w-2/3 bg-slate-800/60 rounded-md" />
          </div>
          <div className="pt-3 border-t border-slate-800/60 flex justify-between">
            <div className="h-3 w-24 bg-slate-800/60 rounded-md" />
            <div className="h-3 w-16 bg-slate-800/60 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}
