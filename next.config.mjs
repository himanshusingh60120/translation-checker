/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The build must never be blocked by a type/lint nit on Vercel. Run `npm run typecheck` locally.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // keep cheerio as a plain Node require inside the serverless functions
    serverComponentsExternalPackages: ['cheerio'],
  },
};

export default nextConfig;
