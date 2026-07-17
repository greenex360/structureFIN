import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  basePath: '/fin',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
}

export default nextConfig
