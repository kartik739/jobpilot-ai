'use client'

import { useEffect, useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { SaveBanner, SaveButton, Field, inputCls, extract422Errors, monthToIso, isoToMonth, type TabProps } from './shared'

const eduSchema = z.object({
  institution: z.string().min(1, 'Institution is required'),
  degree: z.string().min(1, 'Degree is required'),
  field: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  gpa: z.string().optional(),
  description: z.string().optional(),
})

const schema = z.object({
  educations: z.array(eduSchema),
})

type FormValues = z.infer<typeof schema>

type RawEdu = {
  institution?: string
  degree?: string
  field?: string
  startDate?: string
  endDate?: string
  gpa?: number | null
  description?: string
}

export function EducationTab({ profile, mutation }: TabProps) {
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { educations: [] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'educations' })

  useEffect(() => {
    if (!profile) return
    const edus = ((profile.educations as RawEdu[]) ?? []).map((e) => ({
      institution: e.institution ?? '',
      degree: e.degree ?? '',
      field: e.field ?? '',
      startDate: isoToMonth(e.startDate),
      endDate: isoToMonth(e.endDate),
      gpa: e.gpa != null ? String(e.gpa) : '',
      description: e.description ?? '',
    }))
    reset({ educations: edus })
  }, [profile, reset])

  const onSubmit = (data: FormValues) => {
    setServerError(null)
    const payload = data.educations.map((e) => ({
      institution: e.institution,
      degree: e.degree,
      field: e.field || undefined,
      startDate: monthToIso(e.startDate),
      endDate: e.endDate ? monthToIso(e.endDate) : undefined,
      gpa: e.gpa ? parseFloat(e.gpa) : undefined,
      description: e.description || undefined,
    }))
    mutation.mutate(
      { educations: payload },
      {
        onError: (err) => {
          const fe = extract422Errors(err)
          setServerError(fe['educations'] ?? 'Failed to save.')
        },
      }
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Education</h2>
      <p className="text-gray-500 text-sm mb-6">Your academic background.</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        {fields.length === 0 && (
          <div className="py-10 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
            No education records added yet.
          </div>
        )}

        {fields.map((field, idx) => {
          const eduErrors = errors.educations?.[idx]
          return (
            <div key={field.id} className="border border-gray-200 rounded-lg p-5 bg-gray-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700">Education #{idx + 1}</h3>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="text-red-500 hover:text-red-700 text-xs font-medium"
                >
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Institution" required error={eduErrors?.institution?.message}>
                  <input
                    {...register(`educations.${idx}.institution`)}
                    type="text"
                    placeholder="MIT"
                    className={inputCls(!!eduErrors?.institution)}
                  />
                </Field>

                <Field label="Degree" required error={eduErrors?.degree?.message}>
                  <input
                    {...register(`educations.${idx}.degree`)}
                    type="text"
                    placeholder="B.S. Computer Science"
                    className={inputCls(!!eduErrors?.degree)}
                  />
                </Field>

                <Field label="Field of Study">
                  <input
                    {...register(`educations.${idx}.field`)}
                    type="text"
                    placeholder="Computer Science"
                    className={inputCls(false)}
                  />
                </Field>

                <Field label="GPA (optional)">
                  <input
                    {...register(`educations.${idx}.gpa`)}
                    type="text"
                    placeholder="3.8"
                    className={inputCls(false)}
                  />
                </Field>

                <Field label="Start Date">
                  <input
                    {...register(`educations.${idx}.startDate`)}
                    type="month"
                    className={inputCls(false)}
                  />
                </Field>

                <Field label="End Date">
                  <input
                    {...register(`educations.${idx}.endDate`)}
                    type="month"
                    className={inputCls(false)}
                  />
                </Field>
              </div>

              <div className="mt-4">
                <Field label="Description">
                  <textarea
                    {...register(`educations.${idx}.description`)}
                    rows={2}
                    placeholder="Awards, relevant coursework, activities…"
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
            append({ institution: '', degree: '', field: '', startDate: '', endDate: '', gpa: '', description: '' })
          }
          className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + Add Education
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
