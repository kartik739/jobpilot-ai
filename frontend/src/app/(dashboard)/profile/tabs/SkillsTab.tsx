'use client'

import { useEffect, useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { SaveBanner, SaveButton, Field, inputCls, extract422Errors, type TabProps } from './shared'

const PROFICIENCY_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'] as const

const skillSchema = z.object({
  name: z.string().min(1, 'Skill name is required'),
  category: z.string().optional(),
  proficiency: z.string().optional(),
  yearsOfExp: z.string().optional(),
})

const schema = z.object({
  skills: z.array(skillSchema),
})

type FormValues = z.infer<typeof schema>

type RawSkill = {
  name?: string
  category?: string
  proficiency?: string
  yearsOfExp?: number | null
}

export function SkillsTab({ profile, mutation }: TabProps) {
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { skills: [] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'skills' })

  useEffect(() => {
    if (!profile) return
    const sk = ((profile.skills as RawSkill[]) ?? []).map((s) => ({
      name: s.name ?? '',
      category: s.category ?? '',
      proficiency: s.proficiency ?? '',
      yearsOfExp: s.yearsOfExp != null ? String(s.yearsOfExp) : '',
    }))
    reset({ skills: sk })
  }, [profile, reset])

  const onSubmit = (data: FormValues) => {
    setServerError(null)
    const payload = data.skills.map((s) => ({
      name: s.name,
      category: s.category || undefined,
      proficiency: s.proficiency || undefined,
      yearsOfExp: s.yearsOfExp ? parseFloat(s.yearsOfExp) : undefined,
    }))
    mutation.mutate(
      { skills: payload },
      {
        onError: (err) => {
          const fe = extract422Errors(err)
          setServerError(fe['skills'] ?? 'Failed to save.')
        },
      }
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Skills</h2>
      <p className="text-gray-500 text-sm mb-6">Your technical and professional skills.</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {fields.length === 0 && (
          <div className="py-10 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
            No skills added yet.
          </div>
        )}

        <div className="space-y-3">
          {fields.map((field, idx) => {
            const skillErrors = errors.skills?.[idx]
            return (
              <div
                key={field.id}
                className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-start border border-gray-200 rounded-lg p-4 bg-gray-50"
              >
                <Field label="Skill Name" required error={skillErrors?.name?.message}>
                  <input
                    {...register(`skills.${idx}.name`)}
                    type="text"
                    placeholder="TypeScript"
                    className={inputCls(!!skillErrors?.name)}
                  />
                </Field>

                <Field label="Category">
                  <input
                    {...register(`skills.${idx}.category`)}
                    type="text"
                    placeholder="Programming Language"
                    className={inputCls(false)}
                  />
                </Field>

                <Field label="Proficiency">
                  <select
                    {...register(`skills.${idx}.proficiency`)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Select…</option>
                    {PROFICIENCY_LEVELS.map((p) => (
                      <option key={p} value={p}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field label="Years of Exp.">
                      <input
                        {...register(`skills.${idx}.yearsOfExp`)}
                        type="number"
                        min={0}
                        step={0.5}
                        placeholder="3"
                        className={inputCls(false)}
                      />
                    </Field>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    className="mb-0.5 text-red-400 hover:text-red-600 text-sm pb-2"
                    aria-label="Remove skill"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => append({ name: '', category: '', proficiency: '', yearsOfExp: '' })}
          className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + Add Skill
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
