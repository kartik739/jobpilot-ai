'use client'

import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { TagInput, SaveBanner, SaveButton, Field, inputCls, extract422Errors, type TabProps } from './shared'

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'freelance', 'internship'] as const
const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  freelance: 'Freelance',
  internship: 'Internship',
}

const REMOTE_OPTIONS = [
  { value: 'remote_only', label: '🏠 Remote Only' },
  { value: 'hybrid', label: '🔀 Hybrid' },
  { value: 'onsite', label: '🏢 On-site' },
  { value: 'flexible', label: '✨ Flexible' },
] as const

const schema = z.object({
  targetRoles: z.array(z.string()).min(1, 'At least one target role is required'),
  preferredLocations: z.array(z.string()).min(1, 'At least one preferred location is required'),
  remotePreference: z.enum(['remote_only', 'hybrid', 'onsite', 'flexible']),
  employmentTypes: z.array(z.string()),
  salaryMin: z.string().optional(),
  salaryMax: z.string().optional(),
  currency: z.string().optional(),
  excludedCompanies: z.array(z.string()),
  preferredCompanies: z.array(z.string()),
  dailyApplyLimit: z.number().int().min(1).max(50),
  coverLetterReviewMode: z.enum(['auto', 'review_first']),
})

type FormValues = z.infer<typeof schema>

export function PreferencesTab({ profile, mutation }: TabProps) {
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string>>({})

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      targetRoles: [],
      preferredLocations: [],
      remotePreference: 'flexible',
      employmentTypes: [],
      salaryMin: '',
      salaryMax: '',
      currency: 'USD',
      excludedCompanies: [],
      preferredCompanies: [],
      dailyApplyLimit: 10,
      coverLetterReviewMode: 'auto',
    },
  })

  useEffect(() => {
    if (!profile) return
    reset({
      targetRoles: (profile.targetRoles as string[]) ?? [],
      preferredLocations: (profile.preferredLocations as string[]) ?? [],
      remotePreference:
        (['remote_only', 'hybrid', 'onsite', 'flexible'].includes(profile.remotePreference as string)
          ? (profile.remotePreference as 'remote_only' | 'hybrid' | 'onsite' | 'flexible')
          : 'flexible'),
      employmentTypes: (profile.employmentTypes as string[]) ?? [],
      salaryMin: profile.salaryMin != null ? String(profile.salaryMin) : '',
      salaryMax: profile.salaryMax != null ? String(profile.salaryMax) : '',
      currency: (profile.currency as string) ?? 'USD',
      excludedCompanies: (profile.excludedCompanies as string[]) ?? [],
      preferredCompanies: (profile.preferredCompanies as string[]) ?? [],
      dailyApplyLimit: (profile.dailyApplyLimit as number) ?? 10,
      coverLetterReviewMode:
        profile.coverLetterReviewMode === 'review_first' ? 'review_first' : 'auto',
    })
  }, [profile, reset])

  const watchedRemote = watch('remotePreference')

  const onSubmit = (data: FormValues) => {
    setServerFieldErrors({})
    const salaryMin = data.salaryMin ? parseFloat(data.salaryMin) : undefined
    const salaryMax = data.salaryMax ? parseFloat(data.salaryMax) : undefined
    mutation.mutate(
      {
        targetRoles: data.targetRoles,
        preferredLocations: data.preferredLocations,
        remotePreference: data.remotePreference,
        employmentTypes: data.employmentTypes,
        salaryMin,
        salaryMax,
        currency: data.currency || 'USD',
        excludedCompanies: data.excludedCompanies,
        preferredCompanies: data.preferredCompanies,
        dailyApplyLimit: data.dailyApplyLimit,
        coverLetterReviewMode: data.coverLetterReviewMode,
      },
      {
        onError: (err) => setServerFieldErrors(extract422Errors(err)),
      }
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Job Preferences</h2>
      <p className="text-gray-500 text-sm mb-6">Configure what kinds of jobs you&apos;re looking for.</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        {/* Target Roles */}
        <Field
          label="Target Roles"
          required
          error={errors.targetRoles?.message ?? serverFieldErrors.targetRoles}
        >
          <Controller
            name="targetRoles"
            control={control}
            render={({ field }) => (
              <TagInput
                value={field.value}
                onChange={field.onChange}
                placeholder="e.g. Senior Software Engineer (press Enter)"
                error={errors.targetRoles?.message ?? serverFieldErrors.targetRoles}
              />
            )}
          />
        </Field>

        {/* Preferred Locations */}
        <Field
          label="Preferred Locations"
          required
          error={errors.preferredLocations?.message ?? serverFieldErrors.preferredLocations}
        >
          <Controller
            name="preferredLocations"
            control={control}
            render={({ field }) => (
              <TagInput
                value={field.value}
                onChange={field.onChange}
                placeholder='e.g. New York, NY or "Remote" (press Enter)'
                error={errors.preferredLocations?.message ?? serverFieldErrors.preferredLocations}
              />
            )}
          />
        </Field>

        {/* Remote Preference */}
        <Field label="Remote Preference" required error={errors.remotePreference?.message}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
            {REMOTE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex flex-col items-center justify-center p-3 border-2 rounded-lg cursor-pointer transition-colors text-sm font-medium ${
                  watchedRemote === opt.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-600'
                }`}
              >
                <input {...register('remotePreference')} type="radio" value={opt.value} className="sr-only" />
                {opt.label}
              </label>
            ))}
          </div>
        </Field>

        {/* Employment Types */}
        <Field label="Employment Types">
          <Controller
            name="employmentTypes"
            control={control}
            render={({ field }) => (
              <div className="flex flex-wrap gap-3 mt-1">
                {EMPLOYMENT_TYPES.map((type) => {
                  const checked = field.value?.includes(type) ?? false
                  return (
                    <label
                      key={type}
                      className={`inline-flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer transition-colors text-sm ${
                        checked
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        value={type}
                        checked={checked}
                        onChange={(e) => {
                          const current = field.value ?? []
                          if (e.target.checked) {
                            field.onChange([...current, type])
                          } else {
                            field.onChange(current.filter((t: string) => t !== type))
                          }
                        }}
                        className="sr-only"
                      />
                      {EMPLOYMENT_TYPE_LABELS[type]}
                    </label>
                  )
                })}
              </div>
            )}
          />
        </Field>

        {/* Salary Range */}
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Salary Range (optional)</p>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Min Salary" error={serverFieldErrors.salaryMin}>
              <input
                {...register('salaryMin')}
                type="number"
                min={0}
                placeholder="60000"
                className={inputCls(!!serverFieldErrors.salaryMin)}
              />
            </Field>
            <Field label="Max Salary" error={serverFieldErrors.salaryMax}>
              <input
                {...register('salaryMax')}
                type="number"
                min={0}
                placeholder="120000"
                className={inputCls(!!serverFieldErrors.salaryMax)}
              />
            </Field>
            <Field label="Currency">
              <select
                {...register('currency')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="CAD">CAD</option>
                <option value="AUD">AUD</option>
                <option value="INR">INR</option>
              </select>
            </Field>
          </div>
        </div>

        {/* Preferred / Excluded Companies */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Preferred Companies">
            <Controller
              name="preferredCompanies"
              control={control}
              render={({ field }) => (
                <TagInput
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="e.g. Stripe (press Enter)"
                />
              )}
            />
          </Field>
          <Field label="Excluded Companies">
            <Controller
              name="excludedCompanies"
              control={control}
              render={({ field }) => (
                <TagInput
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="e.g. BigCorp (press Enter)"
                />
              )}
            />
          </Field>
        </div>

        {/* Daily Apply Limit + Cover Letter Mode */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field
            label="Daily Apply Limit (max 50)"
            error={errors.dailyApplyLimit?.message}
          >
            <input
              {...register('dailyApplyLimit', { valueAsNumber: true })}
              type="number"
              min={1}
              max={50}
              className={inputCls(!!errors.dailyApplyLimit)}
            />
          </Field>

          <Field label="Cover Letter Review Mode">
            <select
              {...register('coverLetterReviewMode')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="auto">Auto (send without review)</option>
              <option value="review_first">Review First (approve before send)</option>
            </select>
          </Field>
        </div>

        <SaveBanner
          isPending={mutation.isPending}
          isSuccess={mutation.isSuccess}
          isError={mutation.isError}
          error={mutation.error}
        />

        <div className="flex justify-end pt-2">
          <SaveButton isPending={mutation.isPending} />
        </div>
      </form>
    </div>
  )
}
