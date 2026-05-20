'use client'

import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { TagInput, SaveBanner, SaveButton, Field, inputCls, extract422Errors, type TabProps } from './shared'

const WORK_AUTH_OPTIONS = [
  { value: 'us_citizen', label: 'US Citizen' },
  { value: 'green_card', label: 'Green Card' },
  { value: 'h1b', label: 'H-1B' },
  { value: 'opt', label: 'OPT / CPT' },
  { value: 'ead', label: 'EAD' },
  { value: 'tn_visa', label: 'TN Visa' },
  { value: 'other', label: 'Other' },
]

const schema = z.object({
  fullName: z.string().min(1, 'Full name is required').max(200),
  email: z.string().min(1, 'Email is required').email('Must be a valid email').max(254),
  phone: z.string().optional(),
  location: z.string().min(1, 'Location is required'),
  linkedinUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  githubUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  portfolioUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  websiteUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  workAuthorization: z.array(z.string()).min(1, 'At least one work authorization type is required'),
  requiresSponsorship: z.boolean(),
  noticePeriod: z.number().int().min(0, 'Notice period must be 0 or more'),
})

type FormValues = z.infer<typeof schema>

export function PersonalInfoTab({ profile, mutation }: TabProps) {
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string>>({})

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      location: '',
      linkedinUrl: '',
      githubUrl: '',
      portfolioUrl: '',
      websiteUrl: '',
      workAuthorization: [],
      requiresSponsorship: false,
      noticePeriod: 0,
    },
  })

  // Populate form once profile loads
  useEffect(() => {
    if (!profile) return
    reset({
      fullName: (profile.fullName as string) ?? '',
      email: (profile.email as string) ?? '',
      phone: (profile.phone as string) ?? '',
      location: (profile.location as string) ?? '',
      linkedinUrl: (profile.linkedinUrl as string) ?? '',
      githubUrl: (profile.githubUrl as string) ?? '',
      portfolioUrl: (profile.portfolioUrl as string) ?? '',
      websiteUrl: (profile.websiteUrl as string) ?? '',
      workAuthorization: (profile.workAuthorization as string[]) ?? [],
      requiresSponsorship: (profile.requiresSponsorship as boolean) ?? false,
      noticePeriod: (profile.noticePeriod as number) ?? 0,
    })
  }, [profile, reset])

  const onSubmit = (data: FormValues) => {
    setServerFieldErrors({})
    mutation.mutate(
      {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone || undefined,
        location: data.location,
        linkedinUrl: data.linkedinUrl || undefined,
        githubUrl: data.githubUrl || undefined,
        portfolioUrl: data.portfolioUrl || undefined,
        websiteUrl: data.websiteUrl || undefined,
        workAuthorization: data.workAuthorization,
        requiresSponsorship: data.requiresSponsorship,
        noticePeriod: data.noticePeriod,
      },
      {
        onError: (err) => setServerFieldErrors(extract422Errors(err)),
      }
    )
  }

  const allErrors = { ...errors, ...Object.fromEntries(
    Object.entries(serverFieldErrors).map(([k, v]) => [k, { message: v }])
  )}

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Personal Information</h2>
      <p className="text-gray-500 text-sm mb-6">Your basic contact and identity information.</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Full Name" required error={allErrors.fullName?.message as string | undefined}>
            <input
              {...register('fullName')}
              type="text"
              placeholder="Jane Doe"
              className={inputCls(!!allErrors.fullName)}
            />
          </Field>

          <Field label="Email" required error={allErrors.email?.message as string | undefined}>
            <input
              {...register('email')}
              type="email"
              placeholder="jane@example.com"
              className={inputCls(!!allErrors.email)}
            />
          </Field>

          <Field label="Phone" error={errors.phone?.message}>
            <input
              {...register('phone')}
              type="tel"
              placeholder="+1 (555) 000-0000"
              className={inputCls(false)}
            />
          </Field>

          <Field label="Location" required error={allErrors.location?.message as string | undefined}>
            <input
              {...register('location')}
              type="text"
              placeholder="San Francisco, CA"
              className={inputCls(!!allErrors.location)}
            />
          </Field>
        </div>

        <hr className="border-gray-100" />
        <p className="text-sm font-medium text-gray-600">Online Presence</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="LinkedIn URL" error={errors.linkedinUrl?.message}>
            <input
              {...register('linkedinUrl')}
              type="url"
              placeholder="https://linkedin.com/in/..."
              className={inputCls(!!errors.linkedinUrl)}
            />
          </Field>

          <Field label="GitHub URL" error={errors.githubUrl?.message}>
            <input
              {...register('githubUrl')}
              type="url"
              placeholder="https://github.com/..."
              className={inputCls(!!errors.githubUrl)}
            />
          </Field>

          <Field label="Portfolio URL" error={errors.portfolioUrl?.message}>
            <input
              {...register('portfolioUrl')}
              type="url"
              placeholder="https://yourportfolio.com"
              className={inputCls(!!errors.portfolioUrl)}
            />
          </Field>

          <Field label="Website URL" error={errors.websiteUrl?.message}>
            <input
              {...register('websiteUrl')}
              type="url"
              placeholder="https://yoursite.com"
              className={inputCls(!!errors.websiteUrl)}
            />
          </Field>
        </div>

        <hr className="border-gray-100" />
        <p className="text-sm font-medium text-gray-600">Work Authorization</p>

        <Field
          label="Authorization Types"
          required
          error={errors.workAuthorization?.message ?? (serverFieldErrors.workAuthorization)}
        >
          <Controller
            name="workAuthorization"
            control={control}
            render={({ field }) => (
              <div className="flex flex-wrap gap-3">
                {WORK_AUTH_OPTIONS.map((opt) => {
                  const checked = field.value.includes(opt.value)
                  return (
                    <label
                      key={opt.value}
                      className={`inline-flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer transition-colors text-sm ${
                        checked
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        value={opt.value}
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            field.onChange([...field.value, opt.value])
                          } else {
                            field.onChange(field.value.filter((v) => v !== opt.value))
                          }
                        }}
                        className="sr-only"
                      />
                      {opt.label}
                    </label>
                  )
                })}
              </div>
            )}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field
            label="Notice Period (days)"
            required
            error={errors.noticePeriod?.message ?? serverFieldErrors.noticePeriod}
          >
            <input
              {...register('noticePeriod', { valueAsNumber: true })}
              type="number"
              min={0}
              placeholder="0"
              className={inputCls(!!errors.noticePeriod || !!serverFieldErrors.noticePeriod)}
            />
          </Field>

          <Field label="Sponsorship Required">
            <div className="flex items-center gap-2 pt-2">
              <input
                {...register('requiresSponsorship')}
                type="checkbox"
                id="requiresSponsorship"
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              <label htmlFor="requiresSponsorship" className="text-sm text-gray-700">
                I require visa sponsorship
              </label>
            </div>
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
