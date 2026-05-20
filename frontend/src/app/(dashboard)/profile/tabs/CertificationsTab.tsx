'use client'

import { useEffect, useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { SaveBanner, SaveButton, Field, inputCls, extract422Errors, monthToIso, isoToMonth, type TabProps } from './shared'

const certSchema = z.object({
  name: z.string().min(1, 'Certification name is required'),
  issuer: z.string().optional(),
  issueDate: z.string().optional(),
  expiryDate: z.string().optional(),
  credentialId: z.string().optional(),
  credentialUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
})

const schema = z.object({
  certifications: z.array(certSchema),
})

type FormValues = z.infer<typeof schema>

type RawCert = {
  name?: string
  issuer?: string
  issueDate?: string
  expiryDate?: string
  credentialId?: string
  credentialUrl?: string
}

export function CertificationsTab({ profile, mutation }: TabProps) {
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { certifications: [] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'certifications' })

  useEffect(() => {
    if (!profile) return
    const certs = ((profile.certifications as RawCert[]) ?? []).map((c) => ({
      name: c.name ?? '',
      issuer: c.issuer ?? '',
      issueDate: isoToMonth(c.issueDate),
      expiryDate: isoToMonth(c.expiryDate),
      credentialId: c.credentialId ?? '',
      credentialUrl: c.credentialUrl ?? '',
    }))
    reset({ certifications: certs })
  }, [profile, reset])

  const onSubmit = (data: FormValues) => {
    setServerError(null)
    const payload = data.certifications.map((c) => ({
      name: c.name,
      issuer: c.issuer || undefined,
      issueDate: c.issueDate ? monthToIso(c.issueDate) : undefined,
      expiryDate: c.expiryDate ? monthToIso(c.expiryDate) : undefined,
      credentialId: c.credentialId || undefined,
      credentialUrl: c.credentialUrl || undefined,
    }))
    mutation.mutate(
      { certifications: payload },
      {
        onError: (err) => {
          const fe = extract422Errors(err)
          setServerError(fe['certifications'] ?? 'Failed to save.')
        },
      }
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Certifications</h2>
      <p className="text-gray-500 text-sm mb-6">Professional certifications and licenses.</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        {fields.length === 0 && (
          <div className="py-10 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
            No certifications added yet.
          </div>
        )}

        {fields.map((field, idx) => {
          const certErrors = errors.certifications?.[idx]
          return (
            <div key={field.id} className="border border-gray-200 rounded-lg p-5 bg-gray-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700">Certification #{idx + 1}</h3>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="text-red-500 hover:text-red-700 text-xs font-medium"
                >
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Certification Name" required error={certErrors?.name?.message}>
                  <input
                    {...register(`certifications.${idx}.name`)}
                    type="text"
                    placeholder="AWS Solutions Architect"
                    className={inputCls(!!certErrors?.name)}
                  />
                </Field>

                <Field label="Issuing Organization">
                  <input
                    {...register(`certifications.${idx}.issuer`)}
                    type="text"
                    placeholder="Amazon Web Services"
                    className={inputCls(false)}
                  />
                </Field>

                <Field label="Issue Date">
                  <input
                    {...register(`certifications.${idx}.issueDate`)}
                    type="month"
                    className={inputCls(false)}
                  />
                </Field>

                <Field label="Expiry Date">
                  <input
                    {...register(`certifications.${idx}.expiryDate`)}
                    type="month"
                    className={inputCls(false)}
                  />
                </Field>

                <Field label="Credential ID">
                  <input
                    {...register(`certifications.${idx}.credentialId`)}
                    type="text"
                    placeholder="ABC-12345"
                    className={inputCls(false)}
                  />
                </Field>

                <Field label="Credential URL" error={certErrors?.credentialUrl?.message}>
                  <input
                    {...register(`certifications.${idx}.credentialUrl`)}
                    type="url"
                    placeholder="https://verify.example.com/..."
                    className={inputCls(!!certErrors?.credentialUrl)}
                  />
                </Field>
              </div>
            </div>
          )
        })}

        <button
          type="button"
          onClick={() =>
            append({ name: '', issuer: '', issueDate: '', expiryDate: '', credentialId: '', credentialUrl: '' })
          }
          className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + Add Certification
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
