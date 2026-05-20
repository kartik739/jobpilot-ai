import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import NavHeader from '@/components/NavHeader'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'JobPilot AI',
  description: 'AI-powered job application assistant',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <NavHeader />
          {children}
        </Providers>
      </body>
    </html>
  )
}
