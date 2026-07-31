import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default function Home() {
  const cookieStore = cookies()
  const token = cookieStore.get('access_token')?.value
  const isAuthenticated = !!token

  redirect(isAuthenticated ? '/dashboard' : '/login')
}
