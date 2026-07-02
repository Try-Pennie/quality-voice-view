import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useUserScope } from '../hooks/use-queries'
import { PageHero } from '../components/PageHero'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorState } from '@/components/states/ErrorState'
import { ResolverPolicyEditor } from '../components/admin/ResolverPolicyEditor'
import { ModulePromptViewer } from '../components/admin/ModulePromptViewer'

export default function AdminPage() {
  const { user } = useAuth()
  const {
    data: scope,
    isPending,
    isError,
    refetch,
  } = useUserScope(user?.email)

  // While scope resolves, show the layout's normal loading treatment.
  if (isPending) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="text-lg text-pennie-graphite">Loading…</div>
      </div>
    )
  }

  if (isError || !scope) {
    return (
      <ErrorState
        title="Couldn't load your access"
        message="We couldn't determine your permissions. Retry to reload."
        onRetry={() => refetch()}
      />
    )
  }

  // UI-only gate. Real enforcement is Supabase RLS: the INSERT on
  // eavesly_resolver_policies is restricted to god-mode managers server-side,
  // so a non-god-mode user who reaches this page can't actually save anything.
  if (!scope.isGodMode) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="space-y-6 sm:space-y-8 animate-pennie-rise">
      <PageHero
        label="Admin"
        headline="Configuration"
        description="Edit the resolver trigger policy and review the deployed QA module prompts."
      />

      <Tabs defaultValue="policy">
        <TabsList className="bg-pennie-beige">
          <TabsTrigger value="policy">Resolver policy</TabsTrigger>
          <TabsTrigger value="prompts">Module prompts</TabsTrigger>
        </TabsList>
        <TabsContent value="policy" className="mt-6">
          <ResolverPolicyEditor userEmail={scope.email} />
        </TabsContent>
        <TabsContent value="prompts" className="mt-6">
          <ModulePromptViewer />
        </TabsContent>
      </Tabs>
    </div>
  )
}
