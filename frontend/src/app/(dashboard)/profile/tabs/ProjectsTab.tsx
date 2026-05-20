'use client'

import { useEffect, useState } from 'react'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { SaveBanner, SaveButton, Field, TagInput, inputCls, extract422Errors, monthToIso, isoToMonth, type TabProps } from './shared'

const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  repoUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  skills: z.array(z.string()),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isCurrent: z.boolean(),
  highlights: z.array(z.string()),
})

const schema = z.object({
  projects: z.array(projectSchema),
})

type FormValues = z.infer<typeof schema>

type RawProject = {
  name?: string
  description?: string
  url?: string
  repoUrl?: string
  skills?: string[]
  startDate?: string
  endDate?: string
  isCurrent?: boolean
  highlights?: string[]
}

export function ProjectsTab({ profile, mutation }: TabProps) {
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
    defaultValues: { projects: [] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'projects' })

  useEffect(() => {
    if (!profile) return
    const projs = ((profile.projects as RawProject[]) ?? []).map((p) => ({
      name: p.name ?? '',
      description: p.description ?? '',
      url: p.url ?? '',
      repoUrl: p.repoUrl ?? '',
      skills: p.skills ?? [],
      startDate: isoToMonth(p.startDate),
      endDate: isoToMonth(p.endDate),
      isCurrent: p.isCurrent ?? false,
      highlights: p.highlights ?? [],
    }))
    reset({ projects: projs })
  }, [profile, reset])

  const watchedFields = watch('projects')

  const onSubmit = (data: FormValues) => {
    setServerError(null)
    const payload = data.projects.map((p) => ({
      name: p.name,
      description: p.description || undefined,
      url: p.url || undefined,
      repoUrl: p.repoUrl || undefined,
      skills: p.skills,
      startDate: p.startDate ? monthToIso(p.startDate) : undefined,
      endDate: p.isCurrent ? undefined : (p.endDate ? monthToIso(p.endDate) : undefined),
      isCurrent: p.isCurrent,
      highlights: p.highlights,
    }))
    mutation.mutate(
      { projects: payload },
      {
        onError: (err) => {
          const fe = extract422Errors(err)
          setServerError(fe['projects'] ?? 'Failed to save.')
        },
      }
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Projects</h2>
      <p className="text-gray-500 text-sm mb-6">Personal and open-source projects you want to showcase.</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        {fields.length === 0 && (
          <div className="py-10 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
            No projects added yet.
          </div>
        )}

        {fields.map((field, idx) => {
          const projErrors = errors.projects?.[idx]
          const isCurrent = watchedFields?.[idx]?.isCurrent ?? false

          return (
            <div key={field.id} className="border border-gray-200 rounded-lg p-5 bg-gray-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700">Project #{idx + 1}</h3>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="text-red-500 hover:text-red-700 text-xs font-medium"
                >
                  Remove
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Project Name" required error={projErrors?.name?.message}>
                    <input
                      {...register(`projects.${idx}.name`)}
                      type="text"
                      placeholder="My Awesome Project"
                      className={inputCls(!!projErrors?.name)}
                    />
                  </Field>

                  <Field label="Project URL" error={projErrors?.url?.message}>
                    <input
                      {...register(`projects.${idx}.url`)}
                      type="url"
                      placeholder="https://myproject.com"
                      className={inputCls(!!projErrors?.url)}
                    />
                  </Field>

                  <Field label="Repository URL" error={projErrors?.repoUrl?.message}>
                    <input
                      {...register(`projects.${idx}.repoUrl`)}
                      type="url"
                      placeholder="https://github.com/..."
                      className={inputCls(!!projErrors?.repoUrl)}
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Start Date">
                      <input
                        {...register(`projects.${idx}.startDate`)}
                        type="month"
                        className={inputCls(false)}
                      />
                    </Field>
                    <Field label="End Date">
                      <input
                        {...register(`projects.${idx}.endDate`)}
                        type="month"
                        disabled={isCurrent}
                        className={`${inputCls(false)} disabled:opacity-50 disabled:bg-gray-100`}
                      />
                    </Field>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    {...register(`projects.${idx}.isCurrent`)}
                    type="checkbox"
                    id={`projCurrent-${idx}`}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <label htmlFor={`projCurrent-${idx}`} className="text-sm text-gray-700">
                    Currently working on this project
                  </label>
                </div>

                <Field label="Description">
                  <textarea
                    {...register(`projects.${idx}.description`)}
                    rows={2}
                    placeholder="What does this project do?"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </Field>

                <Field label="Technologies / Skills">
                  <Controller
                    name={`projects.${idx}.skills`}
                    control={control}
                    render={({ field }) => (
                      <TagInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="e.g. React, TypeScript (press Enter)"
                      />
                    )}
                  />
                </Field>
              </div>
            </div>
          )
        })}

        <button
          type="button"
          onClick={() =>
            append({
              name: '', description: '', url: '', repoUrl: '',
              skills: [], startDate: '', endDate: '', isCurrent: false, highlights: [],
            })
          }
          className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + Add Project
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
