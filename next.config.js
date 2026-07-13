/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { dev }) => {
    // Windows: webpack/watchpack can try to lstat drive-root system files (EINVAL).
    // Ignore them in dev so the initial scan does not log errors.
    if (dev) {
      const prev = config.watchOptions?.ignored;
      const prevArr = Array.isArray(prev) ? prev : typeof prev === 'string' ? [prev] : [];
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          ...prevArr.filter((pattern) => typeof pattern === 'string' && pattern.trim() !== ''),
          '**/hiberfil.sys',
          '**/pagefile.sys',
          '**/swapfile.sys',
          '**/DumpStack.log.tmp',
        ],
      };
    }

    config.resolve.alias = {
      ...config.resolve.alias,
      'mapbox-gl': 'mapbox-gl',
    };
    // Suppress mapbox-gl webpack warning
    config.module = {
      ...config.module,
      exprContextCritical: false,
    };
    return config;
  },
};

module.exports = nextConfig;