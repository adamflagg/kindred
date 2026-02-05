import { lazy, Suspense } from 'react'

// Lazy load the heavy graph component (~500KB cytoscape)
const SocialNetworkGraph = lazy(() => import('./SocialNetworkGraph'))

interface FriendGroupsViewProps {
  sessionCmId: number
}

export default function FriendGroupsView({ sessionCmId }: FriendGroupsViewProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="spinner-lodge" />
        </div>
      }
    >
      <SocialNetworkGraph sessionCmId={sessionCmId} />
    </Suspense>
  )
}
