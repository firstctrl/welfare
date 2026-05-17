/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@welfare/shared'],
  output: 'standalone',
};
module.exports = nextConfig;
