'use client'

import { useEffect, useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { SaveBanner, SaveButton, Field, inputCls, extract422Errors, monthToIso, isoToMonth, type TabProps } from './shared'

const expSchema = z.object({
  company: z.string().min(1, 'Company is required'),
  title: z.string().min(1, 'Job title is required'),
  location: z.string().optional(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional(),
  isCurrent: z.boolean(),
  description: z.string().optional(),
})

const schema = z.object({
  workExperiences: z.array(expSchema),
})

type FormValues = z.infer<typeof schema>

type RawExp = {
  company?: string
  title?: string
  location?: string
  startDate?: string
  endDate?: string
  isCurrent?: boolean
  description?: string
}

export function ExperienceTab({ profile, mutation }: TabProps) {
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { workExperiences: [] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'workExperiences' })

  useEffect(() => {
    if (!profile) return
    const exps = ((profile.workExperiences as RawExp[]) ?? []).map((e) => ({
      company: e.company ?? '',
      title: e.title ?? '',
      location: e.location ?? '',
      startDate: isoToMonth(e.startDate),
      endDate: isoToMonth(e.endDate),
      isCurrent: e.isCurrent ?? false,
      description: e.description ?? '',
    }))
    reset({ workExperiences: exps })
  }, [profile, reset])

  const watchedFields = watch('workExperiences')

  const onSubmit = (data: FormValues) => {
    setServerError(null)
    const payload = data.workExperiences.map((e) => ({
      company: e.company,
      title: e.title,
      location: e.location || undefined,
      startDate: monthToIso(e.startDate),
      endDate: e.isCurrent ? undefined : (e.endDate ? monthToIso(e.endDate) : undefined),
      isCurrent: e.isCurrent,
      description: e.description || undefined,
    }))
    mutation.mutate(
      { workExperiences: payload },
      {
        onError: (err) => {
          const fe = extract422Errors(err)
          setServerError(fe['workExperiences'] ?? 'Failed to save. Please check your input.')
        },
      }
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Work Experience</h2>
      <p className="text-gray-500 text-sm mb-6">Your professional work history.</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        {fields.length === 0 && (
          <div className="py-10 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
            No work experience added yet.
          </div>
        )}

        {fields.map((field, idx) => {
          const isCurrent = watchedFields?.[idx]?.isCurrent ?? false
          const expErrors = errors.workExperiences?.[idx]

          return (
            <div key={field.id} className="border border-gray-200 rounded-lg p-5 bg-gray-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700">Experience #{idx + 1}</h3>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="text-red-500 hover:text-red-700 text-xs font-medium"
                >
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Company" required error={expErrors?.company?.message}>
                  <input
                    {...register(`workExperiences.${idx}.company`)}
                    type="text"
                    placeholder="Acme Corp"
                    className={inputCls(!!expErrors?.company)}
                  />
                </Field>

                <Field label="Job Title" required error={expErrors?.title?.message}>
                  <input
                    {...register(`workExperiences.${idx}.title`)}
                    type="text"
                    placeholder="Software Engineer"
                    className={inputCls(!!expErrors?.title)}
                  />
                </Field>

                <Field label="Location" error={expErrors?.location?.message}>
                  <input
                    {...register(`workExperiences.${idx}.location`)}
                    type="text"
                    placeholder="San Francisco, CA"
                    className={inputCls(false)}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Start Date" required error={expErrors?.startDate?.message}>
                    <input
                      {...register(`workExperiences.${idx}.startDate`)}
                      type="month"
                      className={inputCls(!!expErrors?.startDate)}
                    />
                  </Field>
                  <Field label="End Date">
                    <input
                      {...register(`workExperiences.${idx}.endDate`)}
                      type="month"
                      disabled={isCurrent}
                      className={`${inputCls(false)} disabled:opacity-50 disabled:bg-gray-100`}
                    />
                  </Field>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <input
                  {...register(`workExperiences.${idx}.isCurrent`)}
                  type="checkbox"
                  id={`isCurrent-${idx}`}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                <label htmlFor={`isCurrent-${idx}`} className="text-sm text-gray-700">
                  I currently work here
                </label>
              </div>

              <div className="mt-4">
                <Field label="Description">
                  <textarea
                    {...register(`workExperiences.${idx}.description`)}
                    rows={3}
                    placeholder="Describe your responsibilities and achievements…"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </Field>
              </div>
            </div>
          )
        })}

        <button
          type="button"
          onClick={() =>
            append({ company: '', title: '', location: '', startDate: '', endDate: '', isCurrent: false, description: '' })
          }
          className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + Add Work Experience
        </button>

        {serverError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {serverError}
          </div>
        )}

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
