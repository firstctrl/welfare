const path = require('path');
const webpack = require('webpack');

const sharedDist = path.resolve(__dirname, '../../packages/shared/dist/index.js');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@welfare/shared'],
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../../'),
  },
  webpack: (config) => {
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^@welfare\/shared$/, sharedDist),
    );
    return config;
  },
};
module.exports = nextConfig;
