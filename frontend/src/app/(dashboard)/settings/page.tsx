'use client'

/**
 * Settings page — tabbed UI for automation, LLM provider, job sources, and account.
 * Requirements: 14.1, 14.3, 14.4, 26.1, 26.2
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  getAgentStatus,
  pauseAutomation,
  resumeAutomation,
  getLLMProvider,
  updateLLMProvider,
  getSources,
  updateSourceEnabled,
  exportData,
  deleteAccount,
  type LLMProvider,
} from '@/lib/settings-api'
import { getProfile, updateProfile } from '@/lib/profile-api'
import { useAuthStore } from '@/store/auth'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'automation' | 'llm' | 'sources' | 'account'

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const llmProviderSchema = z
  .object({
    provider: z.enum(['ollama', 'gemini', 'groq', 'openrouter', 'custom']),
    apiKey: z.string().optional(),
    model: z.string().min(1, 'Model name is required'),
    baseURL: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.provider === 'custom' && (!data.baseURL || data.baseURL.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseURL'],
        message: 'Base URL is required for custom provider',
      })
    }
  })

type LLMProviderFormValues = z.infer<typeof llmProviderSchema>

// ─── Helper: simple inline toast ─────────────────────────────────────────────

function InlineMessage({ type, message }: { type: 'success' | 'error'; message: string }) {
  const colors =
    type === 'success'
      ? 'bg-green-50 border-green-200 text-green-700'
      : 'bg-red-50 border-red-200 text-red-700'
  return (
    <div
      role="alert"
      className={`flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg border ${colors}`}
    >
      <span aria-hidden="true">{type === 'success' ? '✓' : '⚠'}</span>
      <span>{message}</span>
    </div>
  )
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading…">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 bg-gray-100 rounded-lg" />
      ))}
    </div>
  )
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

interface TabBarProps {
  active: Tab
  onChange: (tab: Tab) => void
}

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: 'automation', label: 'Automation', emoji: '⚙️' },
  { id: 'llm', label: 'LLM Provider', emoji: '🤖' },
  { id: 'sources', label: 'Job Sources', emoji: '📡' },
  { id: 'account', label: 'Account', emoji: '👤' },
]

function TabBar({ active, onChange }: TabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      className="flex border-b border-gray-200 mb-8 gap-1 overflow-x-auto"
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          aria-controls={`tabpanel-${tab.id}`}
          id={`tab-${tab.id}`}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg whitespace-nowrap transition-colors ${
            active === tab.id
              ? 'border-b-2 border-blue-600 text-blue-600 bg-blue-50'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          <span aria-hidden="true">{tab.emoji}</span>
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1: Automation
// Requirements: 14.1, 14.3, 14.4
// ─────────────────────────────────────────────────────────────────────────────

function AutomationTab() {
  const queryClient = useQueryClient()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: agentStatus, isLoading: agentLoading, isError: agentError } = useQuery({
    queryKey: ['agent-status'],
    queryFn: getAgentStatus,
  })

  const { data: profile, isLoading: profileLoading, isError: profileError } = useQuery({
    queryKey: ['profile'],
    queryFn: getProfile,
  })

  const isLoading = agentLoading || profileLoading
  const isError = agentError || profileError

  // Local state for slider (controlled separately from server state)
  const [sliderValue, setSliderValue] = useState<number>(10)

  useEffect(() => {
    if (profile) {
      const limit = (profile as { dailyApplyLimit?: number }).dailyApplyLimit ?? 10
      setSliderValue(limit)
    }
  }, [profile])

  // Pause/Resume mutation
  const pauseMutation = useMutation({
    mutationFn: pauseAutomation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-status'] }),
  })

  const resumeMutation = useMutation({
    mutationFn: resumeAutomation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-status'] }),
  })

  // Profile update mutation (for dailyApplyLimit + coverLetterReviewMode)
  const profileMutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
  })

  // Debounced slider update
  const handleSliderChange = useCallback(
    (value: number) => {
      setSliderValue(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        profileMutation.mutate({ dailyApplyLimit: value })
      }, 500)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const handleCoverLetterModeChange = (mode: string) => {
    profileMutation.mutate({ coverLetterReviewMode: mode })
  }

  const handleTogglePause = () => {
    if (agentStatus?.paused) {
      resumeMutation.mutate()
    } else {
      pauseMutation.mutate()
    }
  }

  const isPauseLoading = pauseMutation.isPending || resumeMutation.isPending
  const profileError2 = profileMutation.isError
    ? 'Failed to save preferences. Please try again.'
    : null

  const coverLetterMode =
    (profile as { coverLetterReviewMode?: string } | undefined)?.coverLetterReviewMode ?? 'auto'

  return (
    <section aria-labelledby="tab-automation" id="tabpanel-automation" role="tabpanel">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">Automation Settings</h2>

      {isLoading && <SectionSkeleton rows={4} />}

      {isError && (
        <InlineMessage type="error" message="Failed to load automation settings. Please refresh." />
      )}

      {!isLoading && !isError && (
        <div className="space-y-8">
          {/* Pause/Resume toggle */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-medium text-gray-900">Automation Status</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  {agentStatus?.paused
                    ? 'Automation is paused. Jobs are queued and will process when you resume.'
                    : 'Automation is running and processing applications.'}
                </p>
                {agentStatus && (
                  <dl className="mt-3 grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <dt className="text-xs text-gray-500 uppercase tracking-wide">Today</dt>
                      <dd className="font-semibold text-gray-900 mt-0.5">
                        {agentStatus.todayApplicationCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500 uppercase tracking-wide">Daily Limit</dt>
                      <dd className="font-semibold text-gray-900 mt-0.5">
                        {agentStatus.dailyLimit}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500 uppercase tracking-wide">Remaining</dt>
                      <dd
                        className={`font-semibold mt-0.5 ${
                          agentStatus.limitReached ? 'text-red-600' : 'text-green-600'
                        }`}
                      >
                        {agentStatus.limitReached ? 'Limit reached' : agentStatus.remainingToday}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>

              {/* Toggle switch */}
              <button
                role="switch"
                aria-checked={!agentStatus?.paused}
                aria-label={agentStatus?.paused ? 'Resume automation' : 'Pause automation'}
                disabled={isPauseLoading}
                onClick={handleTogglePause}
                className={`relative inline-flex h-7 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  !agentStatus?.paused ? 'bg-green-500' : 'bg-gray-200'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    !agentStatus?.paused ? 'translate-x-7' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {(pauseMutation.isError || resumeMutation.isError) && (
              <div className="mt-3">
                <InlineMessage type="error" message="Failed to update automation state. Please try again." />
              </div>
            )}
          </div>

          {/* Daily apply limit slider */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <label
              htmlFor="daily-apply-limit"
              className="block font-medium text-gray-900 mb-1"
            >
              Daily Apply Limit
            </label>
            <p className="text-sm text-gray-500 mb-4">
              Maximum number of applications to submit per day (1–50).
            </p>
            <div className="flex items-center gap-4">
              <input
                id="daily-apply-limit"
                type="range"
                min={1}
                max={50}
                value={sliderValue}
                onChange={(e) => handleSliderChange(Number(e.target.value))}
                aria-valuemin={1}
                aria-valuemax={50}
                aria-valuenow={sliderValue}
                aria-label="Daily apply limit"
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <span
                aria-live="polite"
                className="w-10 text-center font-semibold text-gray-900 text-lg tabular-nums"
              >
                {sliderValue}
              </span>
            </div>
            {profileMutation.isSuccess && (
              <div className="mt-2">
                <InlineMessage type="success" message="Preferences saved." />
              </div>
            )}
            {profileError2 && (
              <div className="mt-2">
                <InlineMessage type="error" message={profileError2} />
              </div>
            )}
          </div>

          {/* Cover letter mode */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <fieldset>
              <legend className="font-medium text-gray-900 mb-1">Cover Letter Mode</legend>
              <p className="text-sm text-gray-500 mb-4">
                Choose whether cover letters are sent automatically or queued for your review first.
              </p>
              <div className="space-y-3">
                {[
                  {
                    value: 'auto',
                    label: 'Automatic',
                    description: 'Send cover letters automatically without review.',
                  },
                  {
                    value: 'review_first',
                    label: 'Review First',
                    description: 'Queue cover letters for your approval before sending.',
                  },
                ].map((option) => (
                  <label
                    key={option.value}
                    className="flex items-start gap-3 cursor-pointer group"
                  >
                    <input
                      type="radio"
                      name="coverLetterMode"
                      value={option.value}
                      checked={coverLetterMode === option.value}
                      onChange={() => handleCoverLetterModeChange(option.value)}
                      className="mt-0.5 h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      aria-label={option.label}
                    />
                    <div>
                      <span className="font-medium text-gray-900 text-sm">{option.label}</span>
                      <p className="text-xs text-gray-500 mt-0.5">{option.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2: LLM Provider
// Requirements: 26.1, 26.2
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  ollama: 'Ollama (local)',
  gemini: 'Google Gemini',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  custom: 'Custom / Self-hosted',
}

function LLMProviderTab() {
  const queryClient = useQueryClient()
  const [saveSuccess, setSaveSuccess] = useState(false)

  const { data: llmConfig, isLoading, isError } = useQuery({
    queryKey: ['llm-provider'],
    queryFn: getLLMProvider,
  })

  const mutation = useMutation({
    mutationFn: updateLLMProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-provider'] })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 4000)
    },
  })

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isDirty },
  } = useForm<LLMProviderFormValues>({
    resolver: zodResolver(llmProviderSchema),
    defaultValues: {
      provider: 'ollama',
      apiKey: '',
      model: '',
      baseURL: '',
    },
  })

  // Populate form once data arrives
  useEffect(() => {
    if (llmConfig) {
      reset({
        provider: llmConfig.provider,
        apiKey: '',
        model: llmConfig.model,
        baseURL: llmConfig.baseURL,
      })
    }
  }, [llmConfig, reset])

  const selectedProvider = watch('provider')
  const isOllama = selectedProvider === 'ollama'
  const isCustom = selectedProvider === 'custom'

  const onSubmit = (values: LLMProviderFormValues) => {
    mutation.mutate({
      provider: values.provider,
      model: values.model,
      ...(values.apiKey ? { apiKey: values.apiKey } : {}),
      ...(values.baseURL ? { baseURL: values.baseURL } : {}),
    })
  }

  return (
    <section aria-labelledby="tab-llm" id="tabpanel-llm" role="tabpanel">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">LLM Provider</h2>

      {isLoading && <SectionSkeleton rows={4} />}

      {isError && (
        <InlineMessage type="error" message="Failed to load LLM provider settings. Please refresh." />
      )}

      {!isLoading && !isError && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-5"
          noValidate
        >
          {/* Provider select */}
          <div>
            <label htmlFor="llm-provider" className="block text-sm font-medium text-gray-700 mb-1">
              Provider
            </label>
            <select
              id="llm-provider"
              {...register('provider')}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              aria-label="LLM provider"
            >
              {(Object.entries(PROVIDER_LABELS) as [LLMProvider, string][]).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {errors.provider && (
              <p className="mt-1 text-xs text-red-600" role="alert">
                {errors.provider.message}
              </p>
            )}
          </div>

          {/* API Key — hidden for Ollama */}
          {!isOllama && (
            <div>
              <label htmlFor="llm-api-key" className="block text-sm font-medium text-gray-700 mb-1">
                API Key{' '}
                <span className="text-gray-400 font-normal text-xs">(not stored in plaintext)</span>
              </label>
              <input
                id="llm-api-key"
                type="password"
                autoComplete="off"
                placeholder={llmConfig?.hasApiKey ? '••••••••' : 'Enter API key'}
                {...register('apiKey')}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                aria-label="API key"
                aria-describedby={errors.apiKey ? 'api-key-error' : undefined}
              />
              {errors.apiKey && (
                <p id="api-key-error" className="mt-1 text-xs text-red-600" role="alert">
                  {errors.apiKey.message}
                </p>
              )}
            </div>
          )}

          {/* Model name */}
          <div>
            <label htmlFor="llm-model" className="block text-sm font-medium text-gray-700 mb-1">
              Model Name
            </label>
            <input
              id="llm-model"
              type="text"
              placeholder="e.g. gemini-1.5-flash, llama3, mixtral-8x7b"
              {...register('model')}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              aria-label="Model name"
              aria-describedby={errors.model ? 'model-error' : undefined}
            />
            {errors.model && (
              <p id="model-error" className="mt-1 text-xs text-red-600" role="alert">
                {errors.model.message}
              </p>
            )}
          </div>

          {/* Base URL — always shown for custom, optional for others */}
          {(isCustom || isOllama) && (
            <div>
              <label htmlFor="llm-base-url" className="block text-sm font-medium text-gray-700 mb-1">
                Base URL{isCustom && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              <input
                id="llm-base-url"
                type="url"
                placeholder={
                  isOllama
                    ? 'http://localhost:11434/v1'
                    : 'https://your-llm-endpoint.com/v1'
                }
                {...register('baseURL')}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                aria-label="Base URL"
                aria-required={isCustom}
                aria-describedby={errors.baseURL ? 'base-url-error' : undefined}
              />
              {errors.baseURL && (
                <p id="base-url-error" className="mt-1 text-xs text-red-600" role="alert">
                  {errors.baseURL.message}
                </p>
              )}
            </div>
          )}

          {/* Feedback */}
          {saveSuccess && (
            <InlineMessage type="success" message="LLM provider settings saved successfully." />
          )}
          {mutation.isError && (
            <InlineMessage type="error" message="Failed to save settings. Please check your inputs and try again." />
          )}

          {/* Save button */}
          <div className="pt-1">
            <button
              type="submit"
              disabled={mutation.isPending || !isDirty}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-busy={mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                'Save Provider Settings'
              )}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 3: Job Sources
// Requirements: 14.3
// ─────────────────────────────────────────────────────────────────────────────

function JobSourcesTab() {
  const queryClient = useQueryClient()

  const { data: sources, isLoading, isError } = useQuery({
    queryKey: ['sources'],
    queryFn: getSources,
  })

  // Optimistic toggle state: Map<id, boolean>
  const [optimisticStates, setOptimisticStates] = useState<Map<string, boolean>>(new Map())

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateSourceEnabled(id, enabled),
    onSuccess: (_data, variables) => {
      // Sync server state; clear optimistic override
      setOptimisticStates((prev) => {
        const next = new Map(prev)
        next.delete(variables.id)
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
    onError: (_err, variables) => {
      // Revert optimistic update on error
      setOptimisticStates((prev) => {
        const next = new Map(prev)
        next.delete(variables.id)
        return next
      })
    },
  })

  const handleToggle = (id: string, currentEnabled: boolean) => {
    const newEnabled = !currentEnabled
    // Optimistically update UI
    setOptimisticStates((prev) => new Map(prev).set(id, newEnabled))
    toggleMutation.mutate({ id, enabled: newEnabled })
  }

  const PLATFORM_EMOJI: Record<string, string> = {
    linkedin: '💼',
    indeed: '🔍',
    greenhouse: '🌿',
    lever: '⚙️',
    ashby: '📋',
    wellfound: '🚀',
    remoteok: '🌍',
    ycombinator: '🅨',
    workday: '📂',
    naukri: '🇮🇳',
    smartrecruiters: '🎯',
  }

  return (
    <section aria-labelledby="tab-sources" id="tabpanel-sources" role="tabpanel">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Job Sources</h2>
      <p className="text-sm text-gray-500 mb-6">
        Enable or disable each platform. Platform-specific configuration (API keys, search queries)
        is managed on the{' '}
        <a href="/sources" className="text-blue-600 hover:underline">
          Sources page
        </a>{' '}
        or during onboarding.
      </p>

      {isLoading && <SectionSkeleton rows={4} />}

      {isError && (
        <InlineMessage type="error" message="Failed to load job sources. Please refresh." />
      )}

      {!isLoading && !isError && sources?.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[200px] text-center border-2 border-dashed border-gray-200 rounded-xl py-10 px-6">
          <div className="text-4xl mb-3" aria-hidden="true">📡</div>
          <p className="text-gray-700 font-medium">No sources configured</p>
          <p className="text-gray-400 text-sm mt-1.5 max-w-sm">
            Configure job sources during onboarding to start discovering opportunities.
          </p>
        </div>
      )}

      {!isLoading && !isError && sources && sources.length > 0 && (
        <div className="space-y-3">
          {sources.map((source) => {
            const isEnabled =
              optimisticStates.has(source.id)
                ? optimisticStates.get(source.id)!
                : source.enabled

            return (
              <div
                key={source.id}
                className="bg-white border border-gray-200 rounded-xl px-5 py-4 shadow-sm flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl" aria-hidden="true">
                    {PLATFORM_EMOJI[source.platform.toLowerCase()] ?? '🔗'}
                  </span>
                  <div>
                    <p className="font-medium text-gray-900 capitalize">{source.platform}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {source.lastRunStatus === 'never_run'
                        ? 'Never run'
                        : `Last run: ${
                            source.lastRunAt
                              ? new Date(source.lastRunAt).toLocaleDateString()
                              : 'unknown'
                          } · ${source.lastRunStatus}`}
                    </p>
                  </div>
                </div>

                {/* Toggle */}
                <button
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${source.platform}`}
                  disabled={toggleMutation.isPending && toggleMutation.variables?.id === source.id}
                  onClick={() => handleToggle(source.id, isEnabled)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                    isEnabled ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 4: Account
// ─────────────────────────────────────────────────────────────────────────────

function AccountTab() {
  const router = useRouter()
  const clearAuth = useAuthStore((s) => s.clearAuth)

  // Export
  const [exportError, setExportError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    setExportError(null)
    setIsExporting(true)
    try {
      const blob = await exportData()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'jobpilot-export.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setExportError('Failed to export data. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  // Delete account dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const confirmInputRef = useRef<HTMLInputElement>(null)

  const canConfirmDelete = deleteConfirmText === 'DELETE'

  const openDeleteDialog = () => {
    setDeleteConfirmText('')
    setDeleteError(null)
    setShowDeleteDialog(true)
    // Focus input on next tick
    setTimeout(() => confirmInputRef.current?.focus(), 50)
  }

  const handleDelete = async () => {
    if (!canConfirmDelete) return
    setDeleteError(null)
    setIsDeleting(true)
    try {
      await deleteAccount()
      clearAuth()
      router.push('/')
    } catch {
      setDeleteError('Failed to delete account. Please try again or contact support.')
      setIsDeleting(false)
    }
  }

  return (
    <section aria-labelledby="tab-account" id="tabpanel-account" role="tabpanel">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">Account</h2>

      <div className="space-y-5">
        {/* Export data */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h3 className="font-medium text-gray-900 mb-1">Export My Data</h3>
          <p className="text-sm text-gray-500 mb-4">
            Download a ZIP archive of all your JobPilot AI data including profile, applications,
            and job history.
          </p>
          {exportError && (
            <div className="mb-3">
              <InlineMessage type="error" message={exportError} />
            </div>
          )}
          <button
            onClick={handleExport}
            disabled={isExporting}
            aria-busy={isExporting}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isExporting ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                Exporting…
              </>
            ) : (
              <>
                <span aria-hidden="true">⬇️</span>
                Export My Data
              </>
            )}
          </button>
        </div>

        {/* Delete account */}
        <div className="bg-white border border-red-200 rounded-xl p-5 shadow-sm">
          <h3 className="font-medium text-red-700 mb-1">Delete Account</h3>
          <p className="text-sm text-gray-500 mb-4">
            Permanently delete your account and all associated data. This action{' '}
            <strong className="text-gray-700">cannot be undone</strong>.
          </p>
          <button
            onClick={openDeleteDialog}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
            aria-haspopup="dialog"
          >
            <span aria-hidden="true">🗑</span>
            Delete Account
          </button>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          aria-describedby="delete-dialog-desc"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !isDeleting && setShowDeleteDialog(false)}
            aria-hidden="true"
          />

          {/* Dialog panel */}
          <div className="relative z-10 bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl" aria-hidden="true">⚠️</span>
              <h2 id="delete-dialog-title" className="text-lg font-semibold text-gray-900">
                Delete Account
              </h2>
            </div>

            <p id="delete-dialog-desc" className="text-sm text-gray-600 mb-5">
              This will permanently delete your account and all data including your profile,
              applications, job history, and preferences. This action{' '}
              <strong>cannot be undone</strong>.
            </p>

            <div className="mb-5">
              <label
                htmlFor="delete-confirm-input"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Type <strong className="font-mono text-red-600">DELETE</strong> to confirm
              </label>
              <input
                id="delete-confirm-input"
                ref={confirmInputRef}
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                aria-required="true"
                autoComplete="off"
              />
            </div>

            {deleteError && (
              <div className="mb-4">
                <InlineMessage type="error" message={deleteError} />
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={!canConfirmDelete || isDeleting}
                aria-busy={isDeleting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isDeleting ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                    Deleting…
                  </>
                ) : (
                  'Delete My Account'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Settings page
// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('automation')

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">
          Manage your automation preferences, AI provider, job sources, and account.
        </p>
      </div>

      <TabBar active={activeTab} onChange={setActiveTab} />

      {activeTab === 'automation' && <AutomationTab />}
      {activeTab === 'llm' && <LLMProviderTab />}
      {activeTab === 'sources' && <JobSourcesTab />}
      {activeTab === 'account' && <AccountTab />}
    </div>
  )
}
