'use client'

import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useOnboardingStore } from '@/store/onboarding'

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'freelance', 'internship']
const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  freelance: 'Freelance',
  internship: 'Internship',
}

const schema = z.object({
  targetRoles: z.array(z.string()).min(1, 'At least one target role is required'),
  preferredLocations: z.array(z.string()).min(1, 'At least one preferred location is required'),
  remotePreference: z.enum(['remote_only', 'hybrid', 'onsite', 'flexible'], {
    required_error: 'Remote preference is required',
  }),
  employmentTypes: z.array(z.string()),
  dailyApplyLimit: z.number().int().min(1).max(50).default(10),
  coverLetterReviewMode: z.enum(['auto', 'review_first']),
})

type FormValues = z.infer<typeof schema>

function TagInput({
  value,
  onChange,
  placeholder,
  error,
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder: string
  error?: string
}) {
  const [input, setInput] = useState('')

  const addTag = () => {
    const tag = input.trim()
    if (tag && !value.includes(tag)) {
      onChange([...value, tag])
    }
    setInput('')
  }

  return (
    <div>
      <div className="flex gap-2 mb-2 flex-wrap min-h-[32px]">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="text-blue-500 hover:text-blue-700 font-bold"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTag()
            }
          }}
          placeholder={placeholder}
          className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            error ? 'border-red-400' : 'border-gray-300'
          }`}
        />
        <button
          type="button"
          onClick={addTag}
          className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-sm hover:bg-gray-200 transition-colors"
        >
          Add
        </button>
      </div>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  )
}

export default function PreferencesPage() {
  const router = useRouter()
  const { preferences, setPreferences, setCurrentStep } = useOnboardingStore()

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      targetRoles: preferences.targetRoles,
      preferredLocations: preferences.preferredLocations,
      remotePreference: preferences.remotePreference,
      employmentTypes: preferences.employmentTypes,
      dailyApplyLimit: preferences.dailyApplyLimit,
      coverLetterReviewMode: preferences.coverLetterReviewMode,
    },
  })

  const watchedRemotePreference = watch('remotePreference')

  const onSubmit = (data: FormValues) => {
    setPreferences(data)
    setCurrentStep(7)
    router.push('/source-config')
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Job Preferences</h2>
      <p className="text-gray-500 mb-6">Configure what kinds of jobs you&apos;re looking for.</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        {/* Target Roles */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Target Roles <span className="text-red-500">*</span>
          </label>
          <Controller
            name="targetRoles"
            control={control}
            render={({ field }) => (
              <TagInput
                value={field.value}
                onChange={field.onChange}
                placeholder="e.g. Senior Software Engineer (press Enter)"
                error={errors.targetRoles?.message}
              />
            )}
          />
        </div>

        {/* Preferred Locations */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Preferred Locations <span className="text-red-500">*</span>
          </label>
          <Controller
            name="preferredLocations"
            control={control}
            render={({ field }) => (
              <TagInput
                value={field.value}
                onChange={field.onChange}
                placeholder='e.g. New York, NY or "Remote" (press Enter)'
                error={errors.preferredLocations?.message}
              />
            )}
          />
        </div>

        {/* Remote Preference */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Remote Preference <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(['remote_only', 'hybrid', 'onsite', 'flexible'] as const).map((opt) => {
              const labels: Record<string, string> = {
                remote_only: '🏠 Remote Only',
                hybrid: '🔀 Hybrid',
                onsite: '🏢 On-site',
                flexible: '✨ Flexible',
              }
              return (
                <label
                  key={opt}
                  className={`flex flex-col items-center justify-center p-3 border-2 rounded-lg cursor-pointer transition-colors text-sm font-medium ${
                    watchedRemotePreference === opt
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  }`}
                >
                  <input {...register('remotePreference')} type="radio" value={opt} className="sr-only" />
                  {labels[opt]}
                </label>
              )
            })}
          </div>
          {errors.remotePreference && (
            <p className="text-red-500 text-xs mt-1">{errors.remotePreference.message}</p>
          )}
        </div>

        {/* Employment Types */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Employment Types (optional)
          </label>
          <Controller
            name="employmentTypes"
            control={control}
            render={({ field }) => (
              <div className="flex flex-wrap gap-3">
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
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Daily Apply Limit */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Daily Apply Limit (max 50)
            </label>
            <input
              {...register('dailyApplyLimit', { valueAsNumber: true })}
              type="number"
              min={1}
              max={50}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.dailyApplyLimit ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {errors.dailyApplyLimit && (
              <p className="text-red-500 text-xs mt-1">{errors.dailyApplyLimit.message}</p>
            )}
          </div>

          {/* Cover Letter Review Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cover Letter Review Mode
            </label>
            <select
              {...register('coverLetterReviewMode')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="auto">Auto (send without review)</option>
              <option value="review_first">Review First (approve before send)</option>
            </select>
          </div>
        </div>

        <div className="flex justify-between pt-4">
          <button
            type="button"
            onClick={() => {
              setCurrentStep(5)
              router.push('/resume-upload')
            }}
            className="px-6 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            ← Back
          </button>
          <button
            type="submit"
            className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            Next: Source Config →
          </button>
        </div>
      </form>
    </div>
  )
}
