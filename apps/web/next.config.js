const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@welfare/shared'],
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
};
module.exports = nextConfig;
