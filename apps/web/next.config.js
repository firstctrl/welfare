const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@welfare/shared'],
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../../'),
  },
};
module.exports = nextConfig;
