'use client'

import React from 'react'
import { useOnboardingStore } from '@/store/onboarding'

const STEPS = [
  'Personal Info',
  'Work Experience',
  'Education',
  'Projects',
  'Skills',
  'Resume Upload',
  'Preferences',
  'Source Config',
  'Review',
]

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const currentStep = useOnboardingStore((s) => s.currentStep)
  const progressPercent = Math.round(((currentStep + 1) / STEPS.length) * 100)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top progress bar */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-bold text-gray-900">JobPilot AI</h1>
            <span className="text-sm text-gray-500 font-medium">
              Step {currentStep + 1} of {STEPS.length}
            </span>
          </div>

          {/* Step labels */}
          <div className="hidden sm:flex items-center gap-1 mb-3 overflow-x-auto">
            {STEPS.map((label, idx) => (
              <React.Fragment key={label}>
                <div
                  className={`flex items-center gap-1 flex-shrink-0 ${
                    idx < currentStep
                      ? 'text-green-600'
                      : idx === currentStep
                      ? 'text-blue-600 font-semibold'
                      : 'text-gray-400'
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 flex-shrink-0 ${
                      idx < currentStep
                        ? 'bg-green-100 border-green-600'
                        : idx === currentStep
                        ? 'bg-blue-100 border-blue-600'
                        : 'bg-gray-100 border-gray-300'
                    }`}
                  >
                    {idx < currentStep ? '✓' : idx + 1}
                  </span>
                  <span className="text-xs hidden md:inline">{label}</span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 min-w-[8px] ${
                      idx < currentStep ? 'bg-green-400' : 'bg-gray-200'
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Progress bar */}
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
              role="progressbar"
              aria-valuenow={progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1 sm:hidden">
            {STEPS[currentStep]}
          </p>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center py-8 px-4">
        <div className="w-full max-w-3xl">{children}</div>
      </main>
    </div>
  )
}
