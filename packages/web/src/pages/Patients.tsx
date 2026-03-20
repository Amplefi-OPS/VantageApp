import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Users, Search, ChevronRight, UserPlus, Loader2 } from 'lucide-react'
import { listPatients } from '../api/endpoints'
import type { Patient } from '../api/types'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { NewPatientModal } from '../components/NewPatientModal'
import { formatDate } from '../lib/utils'

const PAGE_SIZE = 25

export default function Patients() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [showNewPatient, setShowNewPatient] = useState(false)
  const [allPatients, setAllPatients] = useState<Patient[]>([])
  const [nextToken, setNextToken] = useState<string | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)

  // Auto-open new patient modal from ?new=1 query param
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowNewPatient(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const { isLoading, isError } = useQuery({
    queryKey: ['patients-paginated'],
    queryFn: async () => {
      const res = await listPatients(undefined, PAGE_SIZE)
      setAllPatients(res.patients)
      setNextToken(res.nextToken)
      return res
    },
  })

  const loadMore = useCallback(async () => {
    if (!nextToken || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await listPatients(nextToken, PAGE_SIZE)
      setAllPatients((prev) => [...prev, ...res.patients])
      setNextToken(res.nextToken)
    } finally {
      setLoadingMore(false)
    }
  }, [nextToken, loadingMore])

  const filtered = allPatients.filter((p) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.firstName.toLowerCase().includes(q) ||
      p.lastName.toLowerCase().includes(q) ||
      p.phone.includes(q)
    )
  })

  if (isLoading) return <LoadingSpinner />
  if (isError) return <div className="text-center py-12 text-warm-gray dark:text-gray-400">Failed to load patients. Please refresh.</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-charcoal dark:text-white">Patients</h1>
        <Button onClick={() => setShowNewPatient(true)} icon={<UserPlus size={18} />}>
          New Patient
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-gray"
        />
        <input
          type="text"
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 rounded-lg border border-light-gray dark:border-gray-600 text-base bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-blue min-h-[48px]"
          aria-label="Search patients"
        />
      </div>

      {filtered.length === 0 && (
        <EmptyState
          icon={<Users size={48} />}
          title={search ? 'No patients found' : 'No patients yet'}
          description={
            search
              ? 'Try a different search term.'
              : 'Patients will appear here when they are added.'
          }
        />
      )}

      <div className="space-y-2">
        {filtered.map((p) => (
          <button
            key={p.id}
            onClick={() => navigate(`/patients/${p.id}`)}
            className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-blue rounded-xl"
          >
            <Card className="hover:shadow-sm transition-shadow">
              <div className="flex items-center gap-4">
                {/* Avatar */}
                <div className="w-12 h-12 rounded-full bg-slate-blue/10 text-slate-blue flex items-center justify-center shrink-0 text-lg font-semibold">
                  {p.firstName[0]}
                  {p.lastName[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-charcoal dark:text-white text-base">
                    {p.firstName} {p.lastName}
                  </p>
                  <p className="text-sm text-warm-gray dark:text-gray-300">{p.phone}</p>
                  {p.dob && (
                    <p className="text-xs text-warm-gray dark:text-gray-300">DOB: {formatDate(p.dob)}</p>
                  )}
                </div>
                <ChevronRight size={20} className="text-warm-gray shrink-0" />
              </div>
            </Card>
          </button>
        ))}
      </div>

      {nextToken && !search && (
        <div className="mt-4 text-center">
          <Button
            variant="ghost"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <>
                <Loader2 size={16} className="animate-spin mr-2" />
                Loading...
              </>
            ) : (
              'Load more patients'
            )}
          </Button>
        </div>
      )}

      <NewPatientModal
        open={showNewPatient}
        onClose={() => {
          setShowNewPatient(false)
          // Refresh the list when modal closes (patient may have been added)
          queryClient.invalidateQueries({ queryKey: ['patients-paginated'] })
        }}
      />
    </div>
  )
}
