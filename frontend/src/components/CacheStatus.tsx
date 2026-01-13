import { useIsFetching } from '@tanstack/react-query';

export default function CacheStatus() {
  const isFetching = useIsFetching();

  if (isFetching === 0) return null;

  return (
    <div className="fixed bottom-24 right-6 z-50 animate-fade-in">
      <div className="card-lodge px-4 py-2.5 flex items-center gap-3 shadow-lodge-lg">
        <div className="spinner-lodge w-4 h-4" />
        <span className="text-sm font-medium text-foreground">Loading...</span>
      </div>
    </div>
  );
}