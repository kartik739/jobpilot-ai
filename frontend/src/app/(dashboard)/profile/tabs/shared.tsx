'use client'

import { useState } from 'react'
import type { UseMutationResult } from '@tanstack/react-query'
import type { ProfileResponse, UpdateProfilePayload } from '@/lib/profile-api'
import axios from 'axios'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProfileMutation = UseMutationResult<
  ProfileResponse,
  unknown,
  UpdateProfilePayload,
  unknown
>

export interface TabProps {
  profile: ProfileResponse | null | undefined
  mutation: ProfileMutation
}

// ─── 422 error extraction ─────────────────────────────────────────────────────

export function extract422Errors(error: unknown): Record<string, string> {
  if (!axios.isAxiosError(error)) return {}
  const data = error.response?.data as {
    details?: { fieldErrors?: Record<string, string[]> }
  } | undefined
  const fieldErrors = data?.details?.fieldErrors ?? {}
  const out: Record<string, string> = {}
  for (const [field, msgs] of Object.entries(fieldErrors)) {
    if (msgs.length > 0) out[field] = msgs[0]
  }
  return out
}

// ─── Success/error banner ─────────────────────────────────────────────────────

export function SaveBanner({
  isPending,
  isSuccess,
  isError,
  error,
}: {
  isPending: boolean
  isSuccess: boolean
  isError: boolean
  error: unknown
}) {
  if (isPending) {
    return (
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
        Saving…
      </div>
    )
  }
  if (isSuccess) {
    return (
      <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
        Saved successfully.
      </div>
    )
  }
  if (isError) {
    const serverMsg = axios.isAxiosError(error)
      ? (error.response?.data as { error?: string })?.error ?? 'An error occurred.'
      : 'An error occurred.'
    return (
      <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
        {serverMsg}
      </div>
    )
  }
  return null
}

// ─── Tag / chip input ─────────────────────────────────────────────────────────

export function TagInput({
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
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setInput('')
  }

  return (
    <div>
      <div className="flex gap-2 mb-2 flex-wrap min-h-[28px]">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="text-blue-500 hover:text-blue-700 font-bold leading-none"
              aria-label={`Remove ${tag}`}
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

// ─── Field wrapper ─────────────────────────────────────────────────────────────

export function Field({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  )
}

// ─── Input class helper ───────────────────────────────────────────────────────

export function inputCls(hasError?: boolean) {
  return `w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    hasError ? 'border-red-400' : 'border-gray-300'
  }`
}

// ─── Save button ──────────────────────────────────────────────────────────────

export function SaveButton({ isPending }: { isPending: boolean }) {
  return (
    <button
      type="submit"
      disabled={isPending}
      className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {isPending ? 'Saving…' : 'Save Changes'}
    </button>
  )
}

// ─── Month ↔ ISO helpers ──────────────────────────────────────────────────────

export function monthToIso(month?: string): string {
  if (!month) return new Date().toISOString()
  const [year, mon] = month.split('-')
  return new Date(`${year}-${mon}-01T00:00:00.000Z`).toISOString()
}

export function isoToMonth(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}
